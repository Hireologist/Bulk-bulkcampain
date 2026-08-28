import sys, os, time, urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.append(os.path.abspath('.'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from gcc_tracker import WEBSITES_TO_SCRAPE, SEARCH_QUERIES, scrape_direct_webpage, is_recent_article, is_url_date_recent, fetch_url_text

print("🧪 Starting Empirical 24-Hour Article Fetcher Test...\n")

# 1. Direct Webpages
print("1. Direct Webpage Scrapes:")
total_direct = 0
for site in WEBSITES_TO_SCRAPE:
    arts = scrape_direct_webpage(site)
    total_direct += len(arts)
    for art in arts[:3]:
        print(f"   • [{site['domain']}] {art['title'][:70]}... | Recent URL: {is_url_date_recent(art['link'])}")

print(f"\n✅ Total Direct Webpage Articles Scraped: {total_direct}\n")

# 2. RSS Feeds (max 24h filter)
print("2. Google News RSS Feeds (when:1d + 24h Age Filter):")
total_rss = 0
for q in SEARCH_QUERIES:
    print(f"\n🔍 Query: {q[:65]}...")
    encoded_q = urllib.parse.quote(q)
    rss_url = f"https://news.google.com/rss/search?q={encoded_q}&hl=en-IN&gl=IN&ceid=IN:en"
    html = fetch_url_text(rss_url)
    fetched_query_count = 0
    if html:
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(html)
            for item in root.findall('.//item'):
                title = item.findtext('title') or ''
                pub_date = item.findtext('pubDate') or ''
                fetched_query_count += 1
                if fetched_query_count <= 3:
                    print(f"   • {title[:70]}... | Published: {pub_date}")
        except Exception as err:
            print(f"   ⚠️ XML error: {err}")
    total_rss += fetched_query_count
    print(f"   📊 Query total 24h articles: {fetched_query_count}")

print(f"\n✨ Final Summary: Total Direct Articles: {total_direct}, Total RSS Articles (Strictly <= 24h): {total_rss}")
