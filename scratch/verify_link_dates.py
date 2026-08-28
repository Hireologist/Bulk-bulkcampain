import sys
import os
import re
from datetime import datetime, timezone, timedelta

sys.path.append(os.path.abspath('.'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from gcc_tracker import WEBSITES_TO_SCRAPE, scrape_direct_webpage, fetch_url_text
from bs4 import BeautifulSoup

print("🔍 Inspecting Live Published Timestamps from Scraped Webpage Articles...\n")

for site in WEBSITES_TO_SCRAPE[:2]:
    domain = site["domain"]
    print(f"=== {domain} ===")
    arts = scrape_direct_webpage(site)
    for art in arts[:4]:
        link = art["link"]
        title = art["title"]
        html = fetch_url_text(link)
        pub_date = "Unknown"
        if html:
            # Check meta tags for published time
            m = re.search(r'property=["\'](article:published_time|og:updated_time|datePublished)["\']\s+content=["\']([^"\']+)["\']', html, re.I)
            if not m:
                m = re.search(r'itemprop=["\']datePublished["\']\s+content=["\']([^"\']+)["\']', html, re.I)
            if not m:
                m = re.search(r'"datePublished":\s*"([^"]+)"', html)
            if m:
                pub_date = m.group(2) if len(m.groups()) > 1 else m.group(1)
        print(f"📰 Title: {title[:75]}")
        print(f"🔗 Link : {link}")
        print(f"🕒 PubDate on Page: {pub_date}\n")
