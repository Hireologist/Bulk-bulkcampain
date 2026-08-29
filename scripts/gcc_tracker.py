import os
import sys
import sqlite3
import urllib.parse
import json
import time
import re
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Optional dependency fallbacks
try:
    import requests
except ImportError:
    requests = None

try:
    import feedparser
except ImportError:
    feedparser = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

# 1. Environment Secrets & Config
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = "openai/gpt-oss-120b"
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_GCC_RADAR_WEBHOOK") or os.getenv("DISCORD_WEBHOOK_URL")

groq_client = None
if GROQ_API_KEY and GROQ_API_KEY.startswith("gsk_"):
    try:
        from groq import Groq
        groq_client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print(f"⚠️ Groq client initialization warning: {e}")

# 2. SQLite Database for Persistent Deduplication
conn = sqlite3.connect("gcc_leads.db")
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(seen_gccs)")
existing_columns = [col[1] for col in cursor.fetchall()]

if not existing_columns or "brand_key" not in existing_columns:
    cursor.execute("DROP TABLE IF EXISTS seen_gccs")
    cursor.execute("""
        CREATE TABLE seen_gccs (
            brand_key TEXT PRIMARY KEY,
            company_name TEXT,
            city TEXT,
            date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

# 3. Direct Website Scraping (NO /feed/ URLs)
WEBSITES_TO_SCRAPE = [
    {
        "url": "https://economictimes.indiatimes.com/tech/funding",
        "domain": "economictimes.indiatimes.com",
        "pattern": r'/tech/(funding|startups)/.*\.cms'
    },
    {
        "url": "https://inc42.com/buzz/",
        "domain": "inc42.com",
        "pattern": r'inc42\.com/buzz/'
    },
    {
        "url": "https://entrackr.com",
        "domain": "entrackr.com",
        "pattern": r'entrackr\.com/'
    },
    {
        "url": "https://yourstory.com",
        "domain": "yourstory.com",
        "pattern": r'yourstory\.com/'
    }
]

# Targeted Google Queries (Strictly Last 24h)
SEARCH_QUERIES = [
    '("Global Capability Center" OR "GCC" OR "Technology Center") ("Ahmedabad" OR "GIFT City" OR "Pune" OR "Mumbai" OR "Bangalore" OR "Hyderabad" OR "Chennai" OR "Gurgaon" OR "Noida") ("launch" OR "set up" OR "expand" OR "opens" OR "invests" OR "leases") when:1d',
    '(startup OR "tech company" OR "D2C" OR "Fintech") (raises OR secures OR bags OR "mops up" OR funding) ("Seed" OR "Series" OR "crore" OR "million" OR "Cr") (India OR Bangalore OR Mumbai OR Delhi OR Gurgaon OR Pune OR Hyderabad OR Ahmedabad) when:1d',
    'site:vccircle.com (raises OR funding OR "Series" OR "Seed" OR "crore" OR "bags") when:1d'
]

TRIGGER_KEYWORDS = [
    "gcc", "capability center", "tech center", "technology center", "r&d center", "innovation center",
    "leases", "office space", "sq ft", "raise", "raised", "raises", "funding", "fund", "funds",
    "bags", "secures", "series", "seed", "invest", "investment", "mops up", "cr", "crore", "million", "$"
]

def fetch_url_text(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
    if requests:
        try:
            res = requests.get(url, headers=headers, timeout=15)
            if res.status_code == 200:
                return res.text
        except Exception as e:
            print(f"⚠️ requests error fetching {url}: {e}")
    
    try:
        import urllib.request
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"⚠️ urllib error fetching {url}: {e}")
        return ""

def is_url_date_recent(url):
    m = re.search(r'/(202[4-9])[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12][0-9]|3[01])/', url)
    if m:
        try:
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            pub_date = datetime(year, month, day, tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            diff_days = (now - pub_date).total_seconds() / 86400
            if diff_days > 1.2:
                return False
        except Exception:
            pass
    return True

def is_webpage_date_recent(html):
    if not html:
        return True
    m = re.search(r'property=["\'](article:published_time|og:updated_time|datePublished)["\']\s+content=["\']([^"\']+)["\']', html, re.I)
    if not m:
        m = re.search(r'itemprop=["\']datePublished["\']\s+content=["\']([^"\']+)["\']', html, re.I)
    if not m:
        m = re.search(r'"datePublished":\s*"([^"]+)"', html)
    if m:
        pub_str = m.group(2) if len(m.groups()) > 1 else m.group(1)
        try:
            if "T" in pub_str:
                clean_str = pub_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_str)
            else:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(pub_str)
            dt_utc = dt.astimezone(timezone.utc)
            now_utc = datetime.now(timezone.utc)
            age_hours = (now_utc - dt_utc).total_seconds() / 3600
            if age_hours > 24.5:
                return False
        except Exception:
            pass
    return True

def scrape_direct_webpage(site_info):
    url = site_info["url"]
    domain = site_info["domain"]
    pattern = site_info["pattern"]
    
    html = fetch_url_text(url)
    if not html:
        return []

    articles = []
    if BeautifulSoup:
        soup = BeautifulSoup(html, 'html.parser')
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            title = a_tag.get_text(strip=True)
            if re.search(pattern, href) and len(title) > 25:
                if not href.startswith("http"):
                    href = f"https://{domain}" + href
                if is_url_date_recent(href):
                    articles.append({"title": title, "summary": "", "link": href})
    else:
        matches = re.findall(r'<a\s+(?:[^>]*?\s+)?href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        for href, raw_title in matches:
            title = re.sub(r'<[^>]+>', '', raw_title).strip()
            if re.search(pattern, href) and len(title) > 25:
                if not href.startswith("http"):
                    href = f"https://{domain}" + href
                if is_url_date_recent(href):
                    articles.append({"title": title, "summary": "", "link": href})

    unique_articles = []
    seen = set()
    for art in articles:
        if art["link"] not in seen:
            seen.add(art["link"])
            # Fetch article page HTML to inspect exact meta published_time
            art_html = fetch_url_text(art["link"])
            if is_webpage_date_recent(art_html):
                unique_articles.append(art)
            
    print(f"📰 Scraped {len(unique_articles)} strictly fresh (<=24h) live stories directly from {domain}")
    return unique_articles[:15]

def normalize_brand(name):
    if not name:
        return ""
    clean = re.sub(r'(?i)\b(technologies|technology|tech|pvt|ltd|limited|inc|corp|india|group|solutions|services|platform|labs|app|semi|capital)\b', '', name)
    clean = re.sub(r'[^a-zA-Z0-9]', '', clean).lower()
    return clean if len(clean) >= 3 else name.lower()

def is_recent_article(entry, max_age_hours=24):
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        article_timestamp = time.mktime(entry.published_parsed)
        age_in_hours = (time.time() - article_timestamp) / 3600
        return age_in_hours <= max_age_hours
    return True

def is_brand_processed(brand_key):
    if not brand_key:
        return False
    cursor.execute("SELECT 1 FROM seen_gccs WHERE brand_key = ?", (brand_key,))
    return cursor.fetchone() is not None

def mark_brand_processed(brand_key, company_name, city):
    if not brand_key:
        return
    cursor.execute("INSERT OR IGNORE INTO seen_gccs (brand_key, company_name, city) VALUES (?, ?, ?)", (brand_key, company_name, city))
    conn.commit()

def is_likely_mandate(title, summary):
    text = (title + " " + summary).lower()
    return any(w in text for w in TRIGGER_KEYWORDS)

def analyze_article_with_llm(title, summary, max_retries=3):
    if not groq_client:
        brand_hint = title.split("-")[0].split("|")[0].split(":")[0].strip()
        clean_brand = normalize_brand(brand_hint)
        return {
            "is_lead": True,
            "company": brand_hint[:14],
            "stage_type": "GCC Expansion",
            "amount_scale": "Undisclosed",
            "city": "India",
            "vc_lead": "Undisclosed",
            "is_gcc": "gcc" in (title + " " + summary).lower()
        }

    prompt = f"""
    Analyze this Indian business news item (published in the last 24 hours):
    Headline: "{title}"
    Snippet: "{summary[:250]}"
    
    Task:
    1. Determine if this represents fresh news from the last 24 hours of:
       a) A company setting up/expanding a GCC, Tech Center, or office facility in India.
       b) An Indian company/startup raising capital (Seed, Series A/B/C/D, Growth, Debt, or Equity >= ₹4 Cr / $500k).
    2. Exclude: generic reports, old news/historical archive, multiple wrap-ups (e.g. 'Multiple' or 'Top 10'), stock market daily wraps, layoffs, government policy announcements.
    
    Return ONLY a JSON object:
    {{
        "is_lead": true/false,
        "company": "Short Core Company Name (max 14 chars, NOT 'Multiple')",
        "stage_type": "New GCC/GCC Expansion/Series A/Series B/Series C/Seed/Growth/Debt",
        "amount_scale": "e.g. ₹62 Cr / $10M / 91k sq ft / 1st India Ctr",
        "city": "Mumbai/Hyderabad/Bangalore/Pune/Ahmedabad/GIFT City/NCR/Chennai/India",
        "vc_lead": "Lead VC / Global HQ / Self-Funded / Undisclosed",
        "is_gcc": true/false
    }}
    """

    models_to_try = [
        MODEL_NAME,                  # 1. Primary: openai/gpt-oss-120b
        "llama-3.3-70b-versatile",   # 2. Fallback 1: Llama 3.3 70B
        "llama-3.1-8b-instant",      # 3. Fallback 2: Llama 3.1 8B
        "mixtral-8x7b-32768"         # 4. Fallback 3: Mixtral 8x7B
    ]

    for model in models_to_try:
        for attempt in range(max_retries):
            try:
                time.sleep(1.0)
                res = groq_client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1
                )
                content = res.choices[0].message.content.strip()
                if content.startswith("```json"):
                    content = content[7:-3].strip()
                elif content.startswith("```"):
                    content = content[3:-3].strip()
                return json.loads(content)
            except Exception as e:
                if "429" in str(e) or "rate_limit" in str(e).lower():
                    time.sleep(2.5 * (attempt + 1))
                else:
                    break

    return {"is_lead": False}

def truncate(text, length):
    text = str(text).strip()
    return text[:length - 2] + ".." if len(text) > length else text.ljust(length)

def post_to_discord(payload_content):
    if not DISCORD_WEBHOOK_URL or not DISCORD_WEBHOOK_URL.startswith("http"):
        print("⚠️ No valid Discord Webhook URL provided. Skipping Discord post.")
        return False

    payload = {
        "content": payload_content,
        "username": "BDM Daily Hitlist",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/3135/3135715.png"
    }

    headers = {"Content-Type": "application/json"}
    payload_data = json.dumps(payload).encode('utf-8')

    if requests:
        try:
            res = requests.post(DISCORD_WEBHOOK_URL, data=payload_data, headers=headers, timeout=10)
            if res.status_code in [200, 204]:
                print("🚀 Message chunk delivered to Discord successfully!")
                return True
            else:
                print(f"Discord Response: {res.status_code}, {res.text}")
        except Exception as e:
            print(f"Failed to post to Discord via requests: {e}")

    try:
        import urllib.request
        req = urllib.request.Request(DISCORD_WEBHOOK_URL, data=payload_data, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as res:
            print("🚀 Message chunk delivered to Discord successfully via urllib!")
            return True
    except Exception as e:
        print(f"Failed to post to Discord via urllib: {e}")

    return False

def send_consolidated_discord_hitlist(leads):
    if not DISCORD_WEBHOOK_URL or not leads:
        print("ℹ️ No new leads to send.")
        return

    now_ist = datetime.now(IST)
    today_str = now_ist.strftime("%d-%b-%Y").upper()

    # 1. Build Compact ASCII Table
    header = f"📊 **BDM DAILY HITLIST | {today_str}**\n"
    table = "```\n"
    table += f"{'COMPANY'.ljust(15)}| {'STAGE/TYPE'.ljust(15)}| {'AMOUNT/SCALE'.ljust(14)}| {'CITY'.ljust(11)}| {'VC / LEAD'.ljust(13)}\n"
    table += "-" * 74 + "\n"

    for item in leads:
        company = truncate(item.get("company", "Company"), 14)
        stage = truncate(item.get("stage_type", "GCC Expansion"), 14)
        scale = truncate(item.get("amount_scale", "Undisclosed"), 13)
        city = truncate(item.get("city", "India"), 10)
        vc = truncate(item.get("vc_lead", "Undisclosed"), 12)
        table += f"{company} | {stage} | {scale} | {city} | {vc}\n"

    table += "```"

    # 2. Build Compact Quick Action Links
    links_lines = ["⚡ **QUICK ACTION LINKS:**"]
    for i, item in enumerate(leads, 1):
        comp_name = item.get("company", "Company")
        city_name = item.get("city", "India")
        is_gcc = item.get("is_gcc", False)
        news_url = item.get("url", "")
        
        if is_gcc:
            dork_lead = f'https://www.google.com/search?q=site:linkedin.com/in+"{urllib.parse.quote(comp_name)}"+("Managing+Director"+OR+"Site+Leader"+OR+"Head+of+India"+OR+"Director+of+Engineering")+"{urllib.parse.quote(city_name)}"'
            links_lines.append(f"{i}. **{comp_name}**: [Site Lead]({dork_lead}) • [News]({news_url})")
        else:
            dork_founder = f'https://www.google.com/search?q=site:linkedin.com/in+"{urllib.parse.quote(comp_name)}"+("Founder"+OR+"CEO"+OR+"Chief+People+Officer"+OR+"Head+of+Talent")'
            vc_lead = item.get("vc_lead", "")
            if vc_lead and vc_lead.lower() not in ["null", "undisclosed", "self-funded", "global hq"]:
                dork_vc = f'https://www.google.com/search?q=site:linkedin.com/in+"{urllib.parse.quote(vc_lead)}"+("Talent+Partner"+OR+"Operating+Partner"+OR+"Head+of+Talent")'
                links_lines.append(f"{i}. **{comp_name}**: [Founder]({dork_founder}) • [VC]({dork_vc}) • [News]({news_url})")
            else:
                links_lines.append(f"{i}. **{comp_name}**: [Founder]({dork_founder}) • [News]({news_url})")

    links_text = "\n".join(links_lines)
    full_message = header + table + "\n" + links_text

    # 3. Smart Chunking to Respect Discord's 2,000-Char Limit
    if len(full_message) <= 1950:
        post_to_discord(full_message)
    else:
        post_to_discord(header + table)
        time.sleep(0.4)
        
        current_chunk = ""
        for line in links_lines:
            if len(current_chunk) + len(line) + 1 > 1900:
                post_to_discord(current_chunk)
                current_chunk = line + "\n"
                time.sleep(0.4)
            else:
                current_chunk += line + "\n"
        if current_chunk:
            post_to_discord(current_chunk)

def run_gcc_radar():
    print(f"🔍 Scanning Direct Webpages + Live Queries with Groq AI...")
    raw_articles = []

    # 1. Direct Web Scraping of Real Sites (NO /feed/)
    for site in WEBSITES_TO_SCRAPE:
        raw_articles.extend(scrape_direct_webpage(site))

    # 2. Targeted Media & GCC Search Index
    for q in SEARCH_QUERIES:
        try:
            encoded_q = urllib.parse.quote(q)
            rss_url = f"https://news.google.com/rss/search?q={encoded_q}&hl=en-IN&gl=IN&ceid=IN:en"
            if feedparser:
                g_feed = feedparser.parse(rss_url)
                for e in g_feed.entries[:20]:
                    if not is_recent_article(e, max_age_hours=24):
                        continue
                    raw_articles.append({
                        "title": e.title,
                        "summary": getattr(e, "summary", ""),
                        "link": e.link
                    })
            else:
                xml_data = fetch_url_text(rss_url)
                if xml_data:
                    import xml.etree.ElementTree as ET
                    root = ET.fromstring(xml_data)
                    for item in root.findall('.//item'):
                        title = item.findtext('title') or ''
                        link = item.findtext('link') or ''
                        summary = item.findtext('description') or ''
                        raw_articles.append({"title": title, "summary": summary, "link": link})
        except Exception as err:
            print(f"⚠️ RSS Search error for query '{q}': {err}")

    verified_leads = []
    seen_in_run = set()

    for art in raw_articles:
        title = art["title"]
        summary = art.get("summary", "")

        if not is_likely_mandate(title, summary):
            continue

        time.sleep(0.6)  # Prevent rate limits
        analysis = analyze_article_with_llm(title, summary)

        if analysis.get("is_lead") and analysis.get("company"):
            company = analysis["company"].strip()
            
            # Filter generic words like 'Multiple'
            if company.lower() in ["multiple", "top 10", "unknown", "india", "startup", "gcc"]:
                continue

            brand_key = normalize_brand(company)

            if brand_key in seen_in_run or is_brand_processed(brand_key):
                continue

            seen_in_run.add(brand_key)
            analysis["url"] = art["link"]
            verified_leads.append(analysis)
            print(f"✅ Added to Hitlist: {company} ({analysis.get('stage_type')})")
            mark_brand_processed(brand_key, company, analysis.get("city", "India"))

    send_consolidated_discord_hitlist(verified_leads)
    print(f"🏁 Finished. Handled {len(verified_leads)} leads.")

if __name__ == "__main__":
    run_gcc_radar()
