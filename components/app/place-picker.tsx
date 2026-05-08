"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";

export interface PickedPlace {
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  googleMapsUrl: string | null;
  photoUrl: string | null;
}

interface Suggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string | null;
}

interface AutocompleteResponse {
  suggestions: Suggestion[];
}

interface DetailsResponse {
  place: {
    placeId: string;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    googleMapsUrl: string | null;
    photoUrl: string | null;
  };
}

const DEBOUNCE_MS = 250;

export function PlacePicker({
  value,
  onChange,
  bias,
  placeholder = "Search for a place...",
  inputId,
  disabled,
}: {
  value: PickedPlace | null;
  onChange: (place: PickedPlace | null) => void;
  bias?: { lat: number; lng: number } | null;
  placeholder?: string;
  inputId?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSelectedNameRef = useRef<string | null>(value?.name ?? null);

  useEffect(() => {
    if (value && value.name !== query) {
      setQuery(value.name);
      lastSelectedNameRef.current = value.name;
    }
    // Only sync down when `value` identity changes — avoid an infinite loop
    // by intentionally omitting `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.placeId]);

  useEffect(() => {
    const trimmed = query.trim();

    // If the input matches the last selected place, don't re-search.
    if (trimmed === (lastSelectedNameRef.current ?? "")) {
      setSuggestions([]);
      return;
    }
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (bias) {
          params.set("lat", String(bias.lat));
          params.set("lng", String(bias.lng));
        }
        const res = await appFetchJson<AutocompleteResponse>(
          `/api/app/places/autocomplete?${params.toString()}`
        );
        if (!cancelled) {
          setSuggestions(res.suggestions);
          setOpen(res.suggestions.length > 0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof AppApiFetchError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Search failed"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, bias?.lat, bias?.lng]);

  async function handleSelect(s: Suggestion) {
    setOpen(false);
    setQuery(s.primaryText);
    lastSelectedNameRef.current = s.primaryText;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ placeId: s.placeId });
      const res = await appFetchJson<DetailsResponse>(
        `/api/app/places/details?${params.toString()}`
      );
      onChange({
        placeId: res.place.placeId,
        name: res.place.name,
        address: res.place.address,
        lat: res.place.lat,
        lng: res.place.lng,
        googleMapsUrl: res.place.googleMapsUrl,
        photoUrl: res.place.photoUrl,
      });
    } catch (err) {
      setError(
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load place"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    lastSelectedNameRef.current = null;
    onChange(null);
  }

  return (
    <div className="relative">
      <Input
        id={inputId}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
          lastSelectedNameRef.current = null;
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay so click on a suggestion still registers.
          setTimeout(() => setOpen(false), 150);
        }}
        autoComplete="off"
      />

      {value && !loading && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleClear}
          tabIndex={-1}
        >
          ×
        </button>
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <ul className="max-h-64 overflow-y-auto py-1 text-sm">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleSelect(s)}
                >
                  <div className="font-medium">{s.primaryText}</div>
                  {s.secondaryText && (
                    <div className="text-xs text-muted-foreground">
                      {s.secondaryText}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {value?.address && (
        <p className="mt-1 text-xs text-muted-foreground">📍 {value.address}</p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {loading && !value && (
        <p className="mt-1 text-xs text-muted-foreground">Searching...</p>
      )}
    </div>
  );
}
