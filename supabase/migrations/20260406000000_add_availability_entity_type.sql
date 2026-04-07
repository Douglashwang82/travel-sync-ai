-- Migration: 20260406000000_add_availability_entity_type
-- Adds 'availability' to the entity_type enum for per-user date availability storage.
-- IF NOT EXISTS makes this idempotent; PG 15 supports ADD VALUE outside a transaction block.

ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'availability';
