import sys
import os
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

sys.path.append(os.path.abspath('.'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from gcc_tracker import WEBSITES_TO_SCRAPE, scrape_direct_webpage, fetch_url_text

IST = timezone(timedelta(hours=5, minutes=30))
now_utc = datetime.now(timezone.utc)

print("🔍 Auditing EVERY SINGLE LINK across all target websites...\n")

total_inspected = 0
older_than_24h = []
newer_than_24h = []

for site in WEBSITES_TO_SCRAPE:
    domain = site["domain"]
    arts = scrape_direct_webpage(site)
    print(f"=== Found {len(arts)} total articles from {domain} ===")
    
    for art in arts:
        total_inspected += 1
        link = art["link"]
        title = art["title"]
        html = fetch_url_text(link)
        
        pub_str = None
        if html:
            m = re.search(r'property=["\'](article:published_time|og:updated_time|datePublished)["\']\s+content=["\']([^"\']+)["\']', html, re.I)
            if not m:
                m = re.search(r'itemprop=["\']datePublished["\']\s+content=["\']([^"\']+)["\']', html, re.I)
            if not m:
                m = re.search(r'"datePublished":\s*"([^"]+)"', html)
            if m:
                pub_str = m.group(2) if len(m.groups()) > 1 else m.group(1)

        age_hours = None
        if pub_str:
            try:
                if "T" in pub_str:
                    clean_str = pub_str.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(clean_str)
                else:
                    dt = parsedate_to_datetime(pub_str)
                dt_utc = dt.astimezone(timezone.utc)
                age_hours = (now_utc - dt_utc).total_seconds() / 3600
            except Exception:
                pass

        status_flag = "UNKNOWN_DATE"
        if age_hours is not None:
            if age_hours <= 24.5:
                status_flag = f"✅ FRESH ({age_hours:.1f}h old)"
                newer_than_24h.append({"domain": domain, "title": title, "age": age_hours, "link": link})
            else:
                status_flag = f"❌ OLD ({age_hours:.1f}h old)"
                older_than_24h.append({"domain": domain, "title": title, "age": age_hours, "link": link})

        print(f" • [{domain}] {title[:60]}... | {status_flag}")

print(f"\n📊 AUDIT SUMMARY:")
print(f" Total Articles Inspected: {total_inspected}")
print(f" Strictly <= 24 Hours    : {len(newer_than_24h)}")
print(f" Older than 24 Hours     : {len(older_than_24h)}")
