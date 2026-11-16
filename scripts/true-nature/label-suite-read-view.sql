CREATE SCHEMA teable_release_reader;
REVOKE ALL ON SCHEMA teable_release_reader FROM PUBLIC;
CREATE VIEW teable_release_reader.workspace WITH (security_barrier=true) AS
SELECT jsonb_build_object(
 'releases',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.title) FROM (
 SELECT r.id,r.title,r.artist_id,a.name AS artist,r.release_date,r.format,r.status,r.delivery_status,
 r.upc_ean,(NULLIF(trim(r.cover_art_url),'') IS NOT NULL) AS has_cover,r.release_ready,r.release_missing,
 r.updated_at,r.parent_release_id
 FROM label_suite.releases r LEFT JOIN label_suite.artists a ON a.id=r.artist_id AND a.org_id=r.org_id
 WHERE r.org_id='true-nature') r),'[]'::jsonb),
 'tracks',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.position,t.title) FROM (
 SELECT t.id,t.title,t.release_id,t.position,t.version,t.isrc,(NULLIF(trim(t.audio_url),'') IS NOT NULL) AS has_audio,
 t.track_ready,t.track_missing,t.clearance_progress,t.updated_at
 FROM label_suite.tracks t JOIN label_suite.releases r ON r.id=t.release_id AND r.org_id=t.org_id
 WHERE t.org_id='true-nature') t),'[]'::jsonb),
 'milestones',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.due_date,m.position) FROM (
 SELECT m.id,m.release_id,m.title,m.phase,m.due_date,m.status,m.is_blocking,m.position
 FROM label_suite.release_milestones m JOIN label_suite.releases r ON r.id=m.release_id AND r.org_id=m.org_id
 WHERE m.org_id='true-nature') m),'[]'::jsonb),
 'campaigns',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.start_date,c.campaign_name) FROM (
 SELECT c.id,c.linked_release_id AS release_id,c.campaign_name,c.campaign_type,c.status,c.start_date,c.end_date,c.main_platform
 FROM label_suite.campaigns c JOIN label_suite.releases r ON r.id=c.linked_release_id AND r.org_id=c.org_id
 WHERE c.org_id='true-nature') c),'[]'::jsonb)
) AS payload;
REVOKE ALL ON teable_release_reader.workspace FROM PUBLIC;
GRANT USAGE ON SCHEMA teable_release_reader TO teable_release_reader;
GRANT SELECT ON teable_release_reader.workspace TO teable_release_reader;
