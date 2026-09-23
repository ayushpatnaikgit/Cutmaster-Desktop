#!/usr/bin/env python3
"""Search the web and get a sourced answer, using Gemini with Google Search.

Usage: python3 scripts/web-search.py "who is Dr. Lesley Ott, NASA Goddard — role, research, profile page"
       python3 scripts/web-search.py --json "..."      # machine-readable

Prints a short answer, then the pages it came from (real URLs you can open,
screenshot or record with scripts/web-capture.mjs). Facts about a real person
must come from these sources — never from memory.
"""
import json, os, sys, urllib.request

args = [a for a in sys.argv[1:] if a != "--json"]
as_json = "--json" in sys.argv
if not args:
    print(__doc__.strip(), file=sys.stderr)
    sys.exit(2)
query = " ".join(args)
model = os.environ.get("AGENT_MODEL", "gemini-3.8-flash")
base = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")

body = {
    "contents": [{"parts": [{"text": (
        "Search the web and answer precisely and briefly. Only state what the sources say; "
        "say plainly when something isn't found. Query:\n\n" + query
    )}]}],
    "tools": [{"google_search": {}}],
}
req = urllib.request.Request(
    f"{base}/models/{model}:generateContent", data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]},
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.load(r)
except Exception as e:  # report, don't crash the agent's loop
    detail = ""
    try:
        detail = json.load(e).get("error", {}).get("message", "")
    except Exception:
        pass
    print(f"web-search.py failed: {e} {detail}".strip(), file=sys.stderr)
    sys.exit(1)

cand = out.get("candidates", [{}])[0]
answer = "\n".join(p.get("text", "") for p in cand.get("content", {}).get("parts", [])).strip()
meta = cand.get("groundingMetadata", {})


def real_url(u):
    """Grounding links are redirects; follow them to the page itself."""
    try:
        req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.geturl()
    except Exception:
        return u


sources, seen = [], set()
for ch in meta.get("groundingChunks", []):
    web = ch.get("web") or {}
    if not web.get("uri"):
        continue
    url = real_url(web["uri"])
    if url in seen:
        continue
    seen.add(url)
    sources.append({"title": web.get("title", ""), "url": url})

if as_json:
    print(json.dumps({"query": query, "answer": answer, "sources": sources, "searches": meta.get("webSearchQueries", [])}, indent=1))
else:
    print(answer or "(no answer)")
    if sources:
        print("\nSources:")
        for s in sources:
            print(f"- {s['title']}: {s['url']}")
    else:
        print("\n(no sources returned — treat the answer as unverified)")
