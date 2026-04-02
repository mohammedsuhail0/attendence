-- Run this in Supabase SQL Editor before syncing student photos
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS photo_path TEXT;

ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS mark_mode TEXT NOT NULL DEFAULT 'biometric';

ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS marked_by UUID REFERENCES profiles(id);
