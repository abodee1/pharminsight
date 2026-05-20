
DELETE FROM public.dispensing_data;
DELETE FROM public.pharmacies;

INSERT INTO public.pharmacies (ods_code, name, address, type, country, region, postcode) VALUES
('FA001', 'Boots Pharmacy — Regent Street', '44-46 Regent Street, London', 'community', 'England', 'London', 'W1B 5RA'),
('FK512', 'Boots Pharmacy — Oxford Street', '193 Oxford Street, London', 'community', 'England', 'London', 'W1D 2JY'),
('FAH04', 'Boots Pharmacy — Piccadilly', '361 Oxford St, London', 'community', 'England', 'London', 'W1C 2JL'),
('FNL97', 'Boots Pharmacy — Manchester Arndale', '49 Market Street, Manchester', 'community', 'England', 'North West', 'M4 3AH'),
('FJ660', 'Boots Pharmacy — Birmingham Bullring', '24-26 High Street, Birmingham', 'community', 'England', 'West Midlands', 'B4 7SL'),
('FQK11', 'Boots Pharmacy — Leeds Trinity', '120-122 Briggate, Leeds', 'community', 'England', 'Yorkshire and the Humber', 'LS1 6NP'),
('FXM69', 'Boots Pharmacy — Bristol Broadmead', '59 Broadmead, Bristol', 'community', 'England', 'South West', 'BS1 3EA'),
('FPC32', 'Boots Pharmacy — Liverpool One', '18-20 Lord Street, Liverpool', 'community', 'England', 'North West', 'L2 1TS'),
('FWE14', 'Boots Pharmacy — Newcastle Eldon Sq.', '11 Northumberland Street, Newcastle', 'community', 'England', 'North East', 'NE1 7DE'),
('FRT55', 'Boots Pharmacy — Sheffield Fargate', '54-58 Fargate, Sheffield', 'community', 'England', 'Yorkshire and the Humber', 'S1 2HE'),
('FT123', 'Well Pharmacy — Coventry City Centre', '15 Hertford Street, Coventry', 'community', 'England', 'West Midlands', 'CV1 1LF'),
('FA942', 'Well Pharmacy — Nottingham Central', '32 Long Row, Nottingham', 'community', 'England', 'East Midlands', 'NG1 2DH'),
('FX441', 'Well Pharmacy — Brighton North Lane', '12 North Road, Brighton', 'community', 'England', 'South East', 'BN1 1YA'),
('FCM23', 'Well Pharmacy — Cambridge Mill Rd', '88 Mill Road, Cambridge', 'community', 'England', 'East of England', 'CB1 2AS'),
('FHQ12', 'Greenlight Pharmacy — Camden', '189 Camden High Street, London', 'community', 'England', 'London', 'NW1 7BU'),
('FLM44', 'Cohens Chemist — Manchester', '12 Wilmslow Road, Manchester', 'community', 'England', 'North West', 'M14 5TQ'),
('FXY77', 'Day Lewis Pharmacy — Croydon', '74 George Street, Croydon', 'community', 'England', 'London', 'CR0 1PD'),
('FPE38', 'Rowlands Pharmacy — Reading', '45 Friar Street, Reading', 'community', 'England', 'South East', 'RG1 1DP'),
('FNY01', 'Pickfords Pharmacy — Plymouth', '57 New George Street, Plymouth', 'community', 'England', 'South West', 'PL1 1RR'),
('FMA88', 'Whitworth Chemists — Sunderland', '94 High Street West, Sunderland', 'community', 'England', 'North East', 'SR1 1TX'),
('GB123', 'Boots Pharmacy — Princes Street', '101-103 Princes Street, Edinburgh', 'community', 'Scotland', 'Lothian', 'EH2 3AA'),
('GA456', 'Lloyds Pharmacy — Glasgow Buchanan', '220 Buchanan Street, Glasgow', 'community', 'Scotland', 'Greater Glasgow & Clyde', 'G1 2GF'),
('GK789', 'Dears Pharmacy — Aberdeen Union St', '232 Union Street, Aberdeen', 'community', 'Scotland', 'Grampian', 'AB10 1TL'),
('GH345', 'Davidsons Chemists — Dundee', '17 Reform Street, Dundee', 'community', 'Scotland', 'Tayside', 'DD1 1RG'),
('FW001', 'Boots Pharmacy — Cardiff Queen St', '24 Queen Street, Cardiff', 'community', 'Wales', 'Cardiff & Vale', 'CF10 2BU'),
('FW234', 'Well Pharmacy — Swansea High St', '54 High Street, Swansea', 'community', 'Wales', 'Swansea Bay', 'SA1 1LE'),
('FW567', 'Rowlands Pharmacy — Wrexham', '12 Hope Street, Wrexham', 'community', 'Wales', 'Betsi Cadwaladr', 'LL11 1BG'),
('NI001', 'Gordons Chemists — Belfast Royal Av.', '38 Royal Avenue, Belfast', 'community', 'Northern Ireland', 'Belfast', 'BT1 1DG'),
('NI045', 'MediCare Pharmacy — Derry', '17 Strand Road, Derry', 'community', 'Northern Ireland', 'Western', 'BT48 7AB'),
('NI078', 'Clear Pharmacy — Lisburn', '22 Bow Street, Lisburn', 'community', 'Northern Ireland', 'South Eastern', 'BT28 1BN');

-- 12 months: offset 0..11 from June 2025
INSERT INTO public.dispensing_data
  (pharmacy_id, year, month, items_dispensed, nms_count, pharmacy_first_count, flu_vaccinations, eps_nominations, eps_items)
SELECT
  p.id,
  CAST(EXTRACT(YEAR  FROM (DATE '2025-06-01' + (offset_m || ' months')::interval)) AS int) AS year,
  CAST(EXTRACT(MONTH FROM (DATE '2025-06-01' + (offset_m || ' months')::interval)) AS int) AS month,
  GREATEST(2500,
    5000 + (abs(hashtext(p.ods_code)) % 5000)
    + CASE WHEN EXTRACT(MONTH FROM (DATE '2025-06-01' + (offset_m || ' months')::interval)) IN (11,12,1,2) THEN 1200 ELSE 0 END
    + (abs(hashtext(p.ods_code || offset_m::text)) % 800) - 400
  )::int AS items_dispensed,
  (20 + (abs(hashtext(p.ods_code || 'nms' || offset_m::text)) % 160))::int AS nms_count,
  (10 + (abs(hashtext(p.ods_code || 'pf' || offset_m::text)) % 90)
    + CASE WHEN EXTRACT(MONTH FROM (DATE '2025-06-01' + (offset_m || ' months')::interval)) IN (11,12,1,2,3) THEN 25 ELSE 0 END
  )::int AS pharmacy_first_count,
  CASE
    WHEN EXTRACT(MONTH FROM (DATE '2025-06-01' + (offset_m || ' months')::interval)) IN (9,10,11,12,1)
      THEN (80 + (abs(hashtext(p.ods_code || 'flu' || offset_m::text)) % 220))
    ELSE (abs(hashtext(p.ods_code || 'flu' || offset_m::text)) % 15)
  END::int AS flu_vaccinations,
  (500 + (abs(hashtext(p.ods_code || 'epsn')) % 3000))::int AS eps_nominations,
  GREATEST(2000, ROUND(
    (5000 + (abs(hashtext(p.ods_code)) % 5000)) * 0.85
  ))::int AS eps_items
FROM public.pharmacies p
CROSS JOIN generate_series(0, 11) AS offset_m;
