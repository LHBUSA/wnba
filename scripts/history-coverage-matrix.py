"""Per-season WNBA coverage matrix from the locally cached ESPN harvest (read-only).

Scoreboards: D:/Workers/wnba-model-data/raw/scoreboard/<year>.json.gz
Summaries:   D:/Workers/wnba-model-data/raw/summary/<event_id>.json.gz  ({source_url, captured_at, status, payload})
"""
import gzip, json, os, collections, sys

RAW = r'D:/Workers/wnba-model-data/raw'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'coverage_matrix.json'

def load(p):
    with gzip.open(p, 'rt', encoding='utf8') as f:
        return json.load(f)

rows = {}
for fn in sorted(os.listdir(os.path.join(RAW, 'scoreboard'))):
    year = int(fn[:4])
    sb = load(os.path.join(RAW, 'scoreboard', fn))
    ev = sb['payload'].get('events', [])
    c = collections.Counter()
    teams = set()
    for e in ev:
        t = (e.get('season') or {}).get('type')
        st = ((e.get('status') or {}).get('type') or {}).get('name')
        c[f'type{t}:{st}'] += 1
        for comp in (e.get('competitions') or [{}])[0].get('competitors', []):
            teams.add(comp.get('id'))
    r = rows.setdefault(year, {'season': year})
    r['scoreboard_events'] = len(ev)
    r['scoreboard_by_type_status'] = dict(c)
    r['scoreboard_team_ids'] = len(teams)
    r['event_ids'] = [e['id'] for e in ev if (e.get('season') or {}).get('type') in (2, 3)]

sumdir = os.path.join(RAW, 'summary')
have = set(f.replace('.json.gz', '') for f in os.listdir(sumdir))
for year, r in rows.items():
    k = collections.Counter()
    n = 0
    for eid in r.pop('event_ids'):
        if eid not in have:
            k['summary_missing'] += 1
            continue
        env = load(os.path.join(sumdir, f'{eid}.json.gz'))
        n += 1
        if env.get('status') != 200:
            k['summary_http_error'] += 1
            continue
        p = env['payload']
        comp = ((p.get('header') or {}).get('competitions') or [{}])[0]
        st = ((comp.get('status') or {}).get('type') or {}).get('name')
        k[f'status:{st}'] += 1
        bt = (p.get('boxscore') or {}).get('teams') or []
        if len(bt) == 2 and all(t.get('statistics') for t in bt):
            k['team_box'] += 1
        bp = (p.get('boxscore') or {}).get('players') or []
        if len(bp) == 2 and all(g.get('statistics') and g['statistics'][0].get('athletes') for g in bp):
            k['player_box'] += 1
            keys = bp[0]['statistics'][0].get('keys') or []
            if 'minutes' in keys:
                k['player_minutes'] += 1
            if 'plusMinus' in keys:
                k['player_plus_minus'] += 1
            if any(a.get('starter') for a in bp[0]['statistics'][0]['athletes']):
                k['starters_flag'] += 1
            if any(a.get('didNotPlay') for g in bp for a in g['statistics'][0]['athletes']):
                k['dnp_flags'] += 1
        plays = p.get('plays') or []
        if plays:
            k['play_by_play'] += 1
            if any((pl.get('coordinate') or {}).get('x') not in (None, -214748340) and abs(((pl.get('coordinate') or {}).get('x') or 0)) < 1000 for pl in plays if pl.get('shootingPlay')):
                k['shot_coordinates'] += 1
        gi = p.get('gameInfo') or {}
        if gi.get('officials'):
            k['officials'] += 1
        if gi.get('attendance'):
            k['attendance'] += 1
        if (gi.get('venue') or {}).get('fullName'):
            k['venue'] += 1
        if p.get('leaders'):
            k['leaders'] += 1
        if p.get('pickcenter') or p.get('odds'):
            k['market_eval_only'] += 1
        if comp.get('series') or any('Game' in (n_.get('headline') or '') for n_ in comp.get('notes') or []):
            k['playoff_series_info'] += 1
        if (p.get('article') or {}).get('headline'):
            k['recap_article'] += 1
        if p.get('standings'):
            k['standings_block'] += 1
        if p.get('seasonseries'):
            k['season_series'] += 1
        ls = [c_.get('linescores') for c_ in comp.get('competitors', [])]
        if all(ls) and ls:
            k['linescores'] += 1
    r['summaries_read'] = n
    r['coverage'] = dict(k)

matrix = [rows[y] for y in sorted(rows)]
json.dump(matrix, open(OUT, 'w'), indent=1)
print('season | sb events | reg/post finals | summaries | team box | player box | minutes | +/- | pbp | shots | officials | attendance | venue | linescores | series info')
for r in matrix:
    s = r['scoreboard_by_type_status']
    fin = s.get('type2:STATUS_FINAL', 0) + s.get('type3:STATUS_FINAL', 0)
    cv = r['coverage']
    print(f"{r['season']} | {r['scoreboard_events']} | {fin} (reg {s.get('type2:STATUS_FINAL',0)} post {s.get('type3:STATUS_FINAL',0)}) other={ {k:v for k,v in s.items() if 'FINAL' not in k} } | {r['summaries_read']} | {cv.get('team_box',0)} | {cv.get('player_box',0)} | {cv.get('player_minutes',0)} | {cv.get('player_plus_minus',0)} | {cv.get('play_by_play',0)} | {cv.get('shot_coordinates',0)} | {cv.get('officials',0)} | {cv.get('attendance',0)} | {cv.get('venue',0)} | {cv.get('linescores',0)} | {cv.get('playoff_series_info',0)} | missing={cv.get('summary_missing',0)} status={ {k:v for k,v in cv.items() if k.startswith('status:')} }")
