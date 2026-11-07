-- Every Dropora store lives on its own sub-domain (name.dropora.net), but the app used to treat them all as "dropora.net",
-- so any new Dropora store was reported as already registered. New links are now keyed by their own sub-domain (code change);
-- this migration re-keys the stores saved before. Safe to run more than once. Nothing else is changed or deleted.
update client_stores
   set url_key = lower(substring(url_raw from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?:www\.)?([^/?#:@]+)'))
 where url_key = 'dropora.net'
   and lower(substring(url_raw from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?:www\.)?([^/?#:@]+)')) like '%.dropora.net';

update client_identifiers ci
   set value = s.url_key
  from client_stores s
 where ci.kind = 'store' and ci.value = 'dropora.net' and s.client_id = ci.client_id and s.url_key like '%.dropora.net';

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to ghamer_app;
