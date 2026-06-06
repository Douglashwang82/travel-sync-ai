#!/usr/bin/env python3
"""
POI Re-ranker Training Script
==============================
Trains a 2-layer MLP that predicts whether a candidate POI will be selected
by the LLM pick assignment, given the user's vibe-query embedding and the
POI's own embedding.

Input:  itinerary_feedback table  (was_selected label + vibe_query text)
        poi_embeddings table       (768-dim Gemini embedding per place_id)
Output: models/poi-reranker-weights.json  (loaded at inference by reranker.ts)

Architecture:
  features = [vibe_query_emb ‖ poi_emb ‖ hadamard(vibe_query_emb, poi_emb)]
           = concat of three 768-dim vectors → 2304-dim input
  → Linear(2304, hidden_dim) → GELU → Linear(hidden_dim, 1) → Sigmoid
  Loss: Binary cross-entropy with class-weight correction for imbalance.

Usage:
  pip install -r requirements-ml.txt
  SUPABASE_URL=... SUPABASE_SECRET_KEY=... GEMINI_API_KEY=... python scripts/train-reranker.py
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from supabase import create_client, Client
import google.generativeai as genai
from tqdm import tqdm


# ─── Configuration ───────────────────────────────────────────────────────────

DEFAULT_HIDDEN = 128
DEFAULT_EPOCHS = 40
DEFAULT_LR = 3e-4
DEFAULT_BATCH = 256
DEFAULT_DROPOUT = 0.15
EMB_DIM = 768
FEAT_DIM = EMB_DIM * 3  # [query ‖ poi ‖ hadamard]


# ─── Supabase helpers ────────────────────────────────────────────────────────

def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SECRET_KEY"]
    return create_client(url, key)


def fetch_feedback(sb: Client) -> list[dict]:
    """Load all itinerary_feedback rows (label + vibe_query + place_id)."""
    print("Fetching feedback rows from Supabase...")
    rows: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            sb.table("itinerary_feedback")
            .select("generation_id,place_id,vibe_query,shortlist_rank,similarity,was_selected")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    print(f"  Loaded {len(rows)} feedback rows")
    return rows


def fetch_poi_embeddings(sb: Client, place_ids: list[str]) -> dict[str, np.ndarray]:
    """Batch-fetch poi_embeddings.embedding for the given place_ids."""
    print(f"Fetching POI embeddings for {len(place_ids)} unique place_ids...")
    result: dict[str, np.ndarray] = {}
    batch_size = 200
    for i in range(0, len(place_ids), batch_size):
        batch = place_ids[i : i + batch_size]
        resp = (
            sb.table("poi_embeddings")
            .select("place_id,embedding")
            .in_("place_id", batch)
            .execute()
        )
        for row in resp.data or []:
            emb = row["embedding"]
            if isinstance(emb, str):
                emb = json.loads(emb)
            result[row["place_id"]] = np.array(emb, dtype=np.float32)
    print(f"  Retrieved embeddings for {len(result)} place_ids")
    return result


def embed_queries(unique_queries: list[str]) -> dict[str, np.ndarray]:
    """Batch-embed unique vibe query strings via Gemini text-embedding-004."""
    api_key = os.environ["GEMINI_API_KEY"]
    genai.configure(api_key=api_key)

    print(f"Embedding {len(unique_queries)} unique vibe queries via Gemini...")
    result: dict[str, np.ndarray] = {}
    batch_size = 100  # Gemini batch limit
    queries_list = list(unique_queries)

    for i in tqdm(range(0, len(queries_list), batch_size), desc="Embedding batches"):
        batch = queries_list[i : i + batch_size]
        resp = genai.embed_content(
            model="models/text-embedding-004",
            content=batch,
            task_type="RETRIEVAL_QUERY",
        )
        for query, emb_vec in zip(batch, resp["embedding"]):
            result[query] = np.array(emb_vec, dtype=np.float32)
        if i + batch_size < len(queries_list):
            time.sleep(0.2)  # avoid rate limiting

    print(f"  Embedded {len(result)} queries")
    return result


# ─── Dataset ─────────────────────────────────────────────────────────────────

class FeedbackDataset(Dataset):
    def __init__(self, features: np.ndarray, labels: np.ndarray):
        self.X = torch.from_numpy(features)
        self.y = torch.from_numpy(labels).float()

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        return self.X[idx], self.y[idx]


# ─── Model ───────────────────────────────────────────────────────────────────

class PoiReranker(nn.Module):
    """2-layer MLP: [query ‖ poi ‖ hadamard] → scalar score ∈ (0, 1)."""

    def __init__(self, input_dim: int = FEAT_DIM, hidden_dim: int = DEFAULT_HIDDEN, dropout: float = DEFAULT_DROPOUT):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.net(x)).squeeze(-1)


# ─── Build feature matrix ────────────────────────────────────────────────────

def build_features(
    rows: list[dict],
    query_embs: dict[str, np.ndarray],
    poi_embs: dict[str, np.ndarray],
) -> tuple[np.ndarray, np.ndarray, int]:
    """
    Returns (X, y, n_skipped).
    Skips rows where either the query or POI embedding is missing.
    """
    feats, labels = [], []
    n_skipped = 0

    for row in rows:
        q_emb = query_embs.get(row["vibe_query"])
        p_emb = poi_embs.get(row["place_id"])
        if q_emb is None or p_emb is None:
            n_skipped += 1
            continue
        hadamard = q_emb * p_emb
        feat = np.concatenate([q_emb, p_emb, hadamard])
        feats.append(feat)
        labels.append(1.0 if row["was_selected"] else 0.0)

    X = np.vstack(feats).astype(np.float32) if feats else np.zeros((0, FEAT_DIM), dtype=np.float32)
    y = np.array(labels, dtype=np.float32)
    return X, y, n_skipped


# ─── Training ────────────────────────────────────────────────────────────────

def train(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    hidden_dim: int,
    epochs: int,
    lr: float,
    batch_size: int,
    dropout: float,
) -> tuple[PoiReranker, float]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on {device}")

    # Class-weight sampler — positives are rare (~10–20% of shortlist)
    pos_count = y_train.sum()
    neg_count = len(y_train) - pos_count
    weights = np.where(y_train == 1.0, neg_count / pos_count, 1.0)
    sampler = WeightedRandomSampler(
        weights=torch.from_numpy(weights).double(),
        num_samples=len(y_train),
        replacement=True,
    )

    train_ds = FeedbackDataset(X_train, y_train)
    val_ds = FeedbackDataset(X_val, y_val)
    train_dl = DataLoader(train_ds, batch_size=batch_size, sampler=sampler)
    val_dl = DataLoader(val_ds, batch_size=batch_size)

    model = PoiReranker(FEAT_DIM, hidden_dim, dropout).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.BCELoss()

    best_val_auc = 0.0
    best_state = None

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        for X_b, y_b in train_dl:
            X_b, y_b = X_b.to(device), y_b.to(device)
            optimizer.zero_grad()
            pred = model(X_b)
            loss = criterion(pred, y_b)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(y_b)
        scheduler.step()

        model.eval()
        val_preds, val_labels = [], []
        with torch.no_grad():
            for X_b, y_b in val_dl:
                pred = model(X_b.to(device)).cpu().numpy()
                val_preds.extend(pred.tolist())
                val_labels.extend(y_b.numpy().tolist())

        val_auc = roc_auc_score(val_labels, val_preds) if len(set(val_labels)) > 1 else 0.5
        avg_loss = train_loss / len(y_train)

        if val_auc > best_val_auc:
            best_val_auc = val_auc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if epoch % 5 == 0 or epoch == 1:
            print(f"  epoch {epoch:3d}/{epochs} | loss={avg_loss:.4f} | val_auc={val_auc:.4f}")

    if best_state is not None:
        model.load_state_dict(best_state)

    print(f"  Best val AUC: {best_val_auc:.4f}")
    return model, best_val_auc


# ─── Weight export ───────────────────────────────────────────────────────────

def export_weights(model: PoiReranker, val_auc: float, train_auc: float, n_samples: int, hidden_dim: int, out_path: Path) -> None:
    """Export model weights as JSON for zero-dependency TypeScript inference."""
    model.eval()
    state = model.state_dict()

    # net.0 = Linear(2304, hidden)  →  w1 shape (hidden, 2304), b1 shape (hidden,)
    # net.3 = Linear(hidden, 1)     →  w2 shape (1, hidden),    b2 shape (1,)
    w1 = state["net.0.weight"].numpy().tolist()   # (hidden_dim, 2304)
    b1 = state["net.0.bias"].numpy().tolist()     # (hidden_dim,)
    w2 = state["net.3.weight"].numpy().tolist()   # (1, hidden_dim)
    b2 = state["net.3.bias"].numpy().tolist()     # (1,)

    payload = {
        "architecture": "mlp_2layer",
        "input_dim": FEAT_DIM,
        "hidden_dim": hidden_dim,
        "w1": w1,
        "b1": b1,
        "w2": w2,
        "b2": b2,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "train_auc": round(train_auc, 4),
        "val_auc": round(val_auc, 4),
        "train_samples": n_samples,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")))
    size_kb = out_path.stat().st_size / 1024
    print(f"Exported weights → {out_path} ({size_kb:.0f} KB)")


# ─── Main ────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train the POI re-ranker MLP")
    p.add_argument("--hidden", type=int, default=DEFAULT_HIDDEN, help="Hidden layer size (default 128)")
    p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS, help="Training epochs (default 40)")
    p.add_argument("--lr", type=float, default=DEFAULT_LR, help="Learning rate (default 3e-4)")
    p.add_argument("--batch", type=int, default=DEFAULT_BATCH, help="Batch size (default 256)")
    p.add_argument("--dropout", type=float, default=DEFAULT_DROPOUT, help="Dropout rate (default 0.15)")
    p.add_argument("--min-samples", type=int, default=500, help="Abort if fewer training samples (default 500)")
    p.add_argument("--out", type=Path, default=Path("models/poi-reranker-weights.json"), help="Output path")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    sb = get_supabase()

    # 1. Load raw feedback
    rows = fetch_feedback(sb)
    if not rows:
        print("No feedback rows found. Run some itinerary generations first.")
        sys.exit(1)

    # 2. Identify unique queries and place_ids
    unique_queries = list({r["vibe_query"] for r in rows})
    unique_place_ids = list({r["place_id"] for r in rows})

    # 3. Embed queries (Gemini) and fetch POI embeddings (Supabase)
    query_embs = embed_queries(unique_queries)
    poi_embs = fetch_poi_embeddings(sb, unique_place_ids)

    # 4. Build feature matrix
    X, y, n_skipped = build_features(rows, query_embs, poi_embs)
    print(f"\nDataset: {len(X)} samples ({int(y.sum())} positive, {int((y == 0).sum())} negative), {n_skipped} skipped (missing embeddings)")

    if len(X) < args.min_samples:
        print(f"Too few samples ({len(X)} < {args.min_samples}). Collect more feedback before training.")
        sys.exit(1)

    if y.sum() < 10:
        print("Too few positive samples (< 10). Collect more feedback before training.")
        sys.exit(1)

    # 5. Train / val split (stratified)
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )
    print(f"Train: {len(X_train)} | Val: {len(X_val)}")
    print(f"Class balance — train: {y_train.mean():.1%} positive | val: {y_val.mean():.1%} positive\n")

    # 6. Train
    model, val_auc = train(
        X_train, y_train, X_val, y_val,
        hidden_dim=args.hidden,
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch,
        dropout=args.dropout,
    )

    # 7. Compute train AUC for reporting
    model.eval()
    with torch.no_grad():
        train_preds = torch.sigmoid(model.net(torch.from_numpy(X_train))).squeeze(-1).numpy()
    train_auc = roc_auc_score(y_train, train_preds) if len(set(y_train.tolist())) > 1 else 0.5
    print(f"\nFinal — train AUC: {train_auc:.4f} | val AUC: {val_auc:.4f}")

    if val_auc < 0.55:
        print("WARNING: val AUC < 0.55 — model is barely above random. Collect more diverse feedback before deploying.")

    # 8. Export
    export_weights(model, val_auc, train_auc, len(X_train), args.hidden, args.out)
    print("\nDone. Deploy by copying the weights file to the server's models/ directory.")
    print("The TypeScript reranker.ts will pick it up on the next cold start.")


if __name__ == "__main__":
    main()
