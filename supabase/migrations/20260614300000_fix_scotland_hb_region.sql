-- Translate raw PHS Scotland HB codes stored in pharmacies.region → full NHS board names.
-- Also handles post-2019 remapped codes (S08000029-S08000032).

WITH hb_map (code, name) AS (
  VALUES
    ('S08000015', 'NHS Ayrshire and Arran'),
    ('S08000016', 'NHS Borders'),
    ('S08000017', 'NHS Dumfries and Galloway'),
    ('S08000018', 'NHS Fife'),
    ('S08000019', 'NHS Forth Valley'),
    ('S08000020', 'NHS Grampian'),
    ('S08000021', 'NHS Greater Glasgow and Clyde'),
    ('S08000022', 'NHS Highland'),
    ('S08000023', 'NHS Lanarkshire'),
    ('S08000024', 'NHS Lothian'),
    ('S08000025', 'NHS Orkney'),
    ('S08000026', 'NHS Shetland'),
    ('S08000027', 'NHS Tayside'),
    ('S08000028', 'NHS Western Isles'),
    ('S08000029', 'NHS Fife'),
    ('S08000030', 'NHS Tayside'),
    ('S08000031', 'NHS Greater Glasgow and Clyde'),
    ('S08000032', 'NHS Lanarkshire')
)
UPDATE pharmacies p
SET    region = hb.name
FROM   hb_map hb
WHERE  p.country = 'Scotland'
  AND  upper(p.region) = hb.code;
