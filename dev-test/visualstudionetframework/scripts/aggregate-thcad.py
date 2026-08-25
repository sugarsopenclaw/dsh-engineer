# Aggregate field coverage across all out-thcad/<drawing>/ extracts.
# Read-only; prints unions + per-drawing counts for docs cross-checking.
import json, os, sys, collections

ROOT = os.path.join(os.path.dirname(__file__), "..", "out-thcad")

def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def iter_jsonl(p, stats=None):
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    if stats is not None:
                        stats["bad_lines"] += 1

drawings = sorted(
    d for d in os.listdir(ROOT)
    if os.path.isdir(os.path.join(ROOT, d))
    and os.path.exists(os.path.join(ROOT, d, "extraction-report.json"))
    and ".manual-" not in d  # preserved evidence dirs, not current extracts
)
print("drawings:", len(drawings))

class_union = collections.Counter()
class_per_drawing = {}
geom_union = collections.Counter()
xdata_apps_union = collections.Counter()
regapp_union = set()
dict_keys = {}
sem = {}
layer_counts = {}
style_names = collections.defaultdict(set)
block_names = collections.defaultdict(set)

for d in drawings:
    base = os.path.join(ROOT, d)
    c = collections.Counter()
    g = collections.Counter()
    xa = collections.Counter()
    stats = collections.Counter()
    for e in iter_jsonl(os.path.join(base, "entities.jsonl"), stats):
        rc = e.get("runtime_class", "?")
        c[rc] += 1
        geo = e.get("geometry") or {}
        g[geo.get("kind", "(none)")] += 1
        for app in (e.get("xdata") or {}):
            xa[app] += 1
    if stats["bad_lines"]:
        print("WARNING %s: %d unparsable entities.jsonl lines skipped" % (d, stats["bad_lines"]))
    class_per_drawing[d] = c
    class_union.update(c)
    geom_union.update(g)
    xdata_apps_union.update(xa)

    tables = load_json(os.path.join(base, "tables.json"))
    layer_counts[d] = len(tables.get("layers", []))
    for s in tables.get("text_styles", []):
        style_names["text_styles"].add(s.get("name"))
    for s in tables.get("dim_styles", []):
        style_names["dim_styles"].add(s.get("name"))
    for s in tables.get("linetypes", []):
        style_names["linetypes"].add(s.get("name"))
    for s in tables.get("reg_apps", []):
        regapp_union.add(s.get("name"))
    for b in tables.get("blocks", []):
        if not b.get("is_anonymous") and not b.get("is_layout"):
            block_names[d].add(b.get("name"))

    dk = collections.Counter()
    for rec in iter_jsonl(os.path.join(base, "dictionaries.jsonl")):
        dk[rec.get("key")] = dk[rec.get("key")] + 1
    dict_keys[d] = dk

    so = load_json(os.path.join(base, "semantic-objects.json"))
    tb_fields = set()
    for tb in so.get("title_blocks", []):
        tb_fields.update((tb.get("fields") or {}).keys())
    bom_field_sets = collections.Counter()
    for row in so.get("bom_rows", []):
        bom_field_sets[tuple(sorted((row.get("fields") or {}).keys()))] += 1
    prof = collections.Counter(p.get("runtime_class") for p in so.get("professional_entities", []))
    other = collections.Counter(p.get("block_name") for p in so.get("other_pc_blocks", []))
    sem[d] = dict(
        title_blocks=len(so.get("title_blocks", [])),
        title_block_fields=sorted(tb_fields),
        bom_rows=len(so.get("bom_rows", [])),
        bom_field_sets={"/".join(k): v for k, v in bom_field_sets.items()},
        professional=dict(prof),
        other_pc_blocks=dict(other),
    )

print("\n== runtime_class union (%d) ==" % len(class_union))
for k, v in class_union.most_common():
    per = " ".join("%s:%d" % (d[:22], class_per_drawing[d].get(k, 0)) for d in drawings)
    print("%-28s %6d   %s" % (k, v, per))

print("\n== geometry.kind union ==")
for k, v in geom_union.most_common():
    print("%-20s %6d" % (k, v))

print("\n== xdata apps actually on entities ==")
for k, v in xdata_apps_union.most_common():
    print("%-28s %6d" % (k, v))

print("\n== semantic per drawing ==")
for d in drawings:
    s = sem[d]
    print("%-28s tb=%d bom_rows=%d prof=%s other=%s" % (
        d, s["title_blocks"], s["bom_rows"], s["professional"], s["other_pc_blocks"]))
    print("    tb_fields(%d): %s" % (len(s["title_block_fields"]), ",".join(s["title_block_fields"])))
    print("    bom_field_sets: %s" % s["bom_field_sets"])

print("\n== dict keys per drawing ==")
allk = sorted({k for d in drawings for k in dict_keys[d]})
for k in allk:
    print("%-24s %s" % (k, " ".join("%s:%d" % (d[:22], dict_keys[d].get(k, 0)) for d in drawings)))

print("\n== layers per drawing ==", layer_counts)
print("\n== text_styles union ==", sorted(x for x in style_names["text_styles"] if x))
print("\n== dim_styles union ==", sorted(x for x in style_names["dim_styles"] if x))
print("\n== linetypes union ==", sorted(x for x in style_names["linetypes"] if x))
print("\n== regapp union (%d) ==" % len(regapp_union))
for n in sorted(x for x in regapp_union if x):
    print("  ", n)
print("\n== named non-layout blocks per drawing ==")
for d in drawings:
    print("%-28s %d: %s" % (d, len(block_names[d]), ",".join(sorted(block_names[d]))))
