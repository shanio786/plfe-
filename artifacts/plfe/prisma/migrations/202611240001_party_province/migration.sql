ALTER TABLE parties ADD COLUMN province text;
ALTER TABLE parties ADD CONSTRAINT parties_province_valid CHECK (
  province IS NULL OR province IN (
    'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory'
  )
);
