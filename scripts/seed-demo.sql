-- Seed data for the public demo deployment.
--
-- Fictional. acme-crm.example uses the reserved .example TLD, so it can
-- never resolve to a real site and nothing here can be mistaken for a real
-- measurement. Apply with:
--   npx wrangler d1 execute <db> --remote --file scripts/seed-demo.sql

DELETE FROM regional_metrics; DELETE FROM citations; DELETE FROM reviews;
DELETE FROM backlinks; DELETE FROM geo_prompts; DELETE FROM keywords; DELETE FROM sites;

INSERT INTO sites (id, domain, name, created_at) VALUES (1, 'acme-crm.example', 'Acme CRM (demo)', '2026-06-25T00:00:02.208914Z');

INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'best crm for startups',14,5200,120,'usa','DESKTOP','2026-09-09T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'what is a crm',3,9100,880,'usa','MOBILE','2026-09-06T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm pricing',22,3100,40,'deu','DESKTOP','2026-09-09T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'how to choose a crm',8,2400,210,'gbr','DESKTOP','2026-09-09T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'free crm tools',31,1800,15,'deu','MOBILE','2026-09-07T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm for small business',6,7400,610,'usa','DESKTOP','2026-09-05T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm integrations',17,2100,90,'fra','DESKTOP','2026-09-17T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'why use a crm',4,3300,420,'gbr','MOBILE','2026-09-18T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm vs spreadsheet',11,1500,130,'can','DESKTOP','2026-09-07T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'sales pipeline software',26,2700,55,'aus','DESKTOP','2026-09-08T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm migration guide',19,900,35,'usa','DESKTOP','2026-09-03T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'open source crm',44,1200,8,'ind','MOBILE','2026-09-04T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm onboarding checklist',9,1100,140,'usa','DESKTOP','2026-09-18T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'customer data platform',38,2200,20,'deu','DESKTOP','2026-09-20T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'crm automation',13,3900,260,'gbr','DESKTOP','2026-09-09T00:00:02.208914Z');
INSERT INTO keywords (site_id,keyword,position,impressions,clicks,country,device,updated_at) VALUES (1,'lead scoring',21,1700,70,'nld','DESKTOP','2026-09-14T00:00:02.208914Z');

INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'best crm for startups','gpt-4o',0,'I''d suggest HubSpot or Pipedrive for early-stage teams.','2026-09-21T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'what is a crm','gpt-4o',1,'…tools like acme-crm.example explain the basics clearly…','2026-09-22T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'crm for small business','claude-3.5',0,'Salesforce Essentials is a common pick for small teams.','2026-09-15T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'what is a crm','claude-3.5',1,'…see acme-crm.example for a concise primer on pipelines…','2026-09-23T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'how to choose a crm','gpt-4o',1,'…acme-crm.example publishes a comparison worth reading…','2026-09-14T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'free crm tools','gemini-1.5',0,'HubSpot''s free tier is the usual recommendation.','2026-09-17T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'crm automation','claude-3.5',1,'…acme-crm.example documents its automation recipes…','2026-09-16T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'crm vs spreadsheet','gpt-4o',0,'Most teams outgrow spreadsheets around 50 contacts.','2026-09-14T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'lead scoring','perplexity',0,'Several vendors cover this; see industry guides.','2026-09-21T00:00:02.208914Z');
INSERT INTO geo_prompts (site_id,prompt,model,cited,excerpt,updated_at) VALUES (1,'crm integrations','gemini-1.5',1,'…acme-crm.example lists native integrations…','2026-09-14T00:00:02.208914Z');

INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.commerce.gov/blog/crm-guide','acme-crm.example','crm guide',95,95,0,'2026-09-22T00:00:02.208914Z','2026-09-22T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://cs.stanford.edu/notes/crm','acme-crm.example','research',90,90,0,'2026-07-31T00:00:02.208914Z','2026-07-31T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.g2.com/products/acme','acme-crm.example','acme crm',60,60,0,'2026-08-20T00:00:02.208914Z','2026-08-20T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.capterra.com/p/acme','acme-crm.example','acme',58,58,0,'2026-09-18T00:00:02.208914Z','2026-09-18T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://techcrunch.com/2026/03/acme','acme-crm.example','funding',78,78,0,'2026-09-19T00:00:02.208914Z','2026-09-19T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://news.ycombinator.com/item?id=1','acme-crm.example','discussion',72,72,0,'2026-09-20T00:00:02.208914Z','2026-09-20T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.nature.com/articles/crm-study','acme-crm.example','study',88,88,0,'2026-09-10T00:00:02.208914Z','2026-09-10T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://blog.example.dev/tools','acme-crm.example','tooling',41,41,0,'2026-07-28T00:00:02.208914Z','2026-07-28T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.trustpilot.com/review/acme','acme-crm.example','reviews',62,62,0,'2026-09-07T00:00:02.208914Z','2026-09-07T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://old-partner.example/link','acme-crm.example','partner',28,28,1,'2026-08-15T00:00:02.208914Z','2026-08-15T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://defunct-blog.example/post','acme-crm.example','mention',19,19,1,'2026-09-21T00:00:02.208914Z','2026-09-21T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://www.bbb.org/us/acme','acme-crm.example','profile',55,55,0,'2026-08-04T00:00:02.208914Z','2026-08-04T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://producthunt.com/posts/acme','acme-crm.example','launch',66,66,0,'2026-08-24T00:00:02.208914Z','2026-08-24T00:00:02.208914Z');
INSERT INTO backlinks (site_id,source,target,anchor,domain_authority,authority,lost,first_seen,created_at) VALUES (1,'https://dev.to/acme/post','acme-crm.example','writeup',47,47,0,'2026-09-02T00:00:02.208914Z','2026-09-02T00:00:02.208914Z');

INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'trustpilot','Ana',5,'Absolutely love it, fantastic and reliable',0.92,'2026-09-23T00:00:02.208914Z',NULL);
INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'trustpilot','Bo',2,'Confusing and slow, disappointing',-0.78,'2026-09-19T00:00:02.208914Z',NULL);
INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'g2','Chi',4,'Great automation, helpful support',0.66,'2026-09-15T00:00:02.208914Z',NULL);
INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'g2','Dee',3,'Fine, does the job',0.05,'2026-09-11T00:00:02.208914Z',NULL);
INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'google_business','Eli',5,'Best crm we have used, brilliant',0.95,'2026-09-07T00:00:02.208914Z',NULL);
INSERT INTO reviews (site_id,source,author,rating,body,sentiment,posted_at,url) VALUES (1,'google_business','Fay',1,'Terrible migration, wanted a refund',-0.9,'2026-09-03T00:00:02.208914Z',NULL);
