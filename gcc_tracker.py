import os
import sys
import sqlite3
import urllib.parse
import json
import time
import re
import xml.etree.ElementTree as ET
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

# 3. Direct Website Scraping Targets
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

def is_within_last_24h(pub_date_str):
    if not pub_date_str:
        return True
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(pub_date_str)
        now = datetime.now(timezone.utc)
        diff_hours = (now - dt.astimezone(timezone.utc)).total_seconds() / 3600
        return diff_hours <= 24.5
    except Exception:
        return True

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
    
    # Fallback to urllib
    try:
        import urllib.request
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"⚠️ urllib error fetching {url}: {e}")
        return ""

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
                articles.append({"title": title, "summary": "", "link": href})
    else:
        # Regex fallback for link and title extraction
        matches = re.findall(r'<a\s+(?:[^>]*?\s+)?href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        for href, raw_title in matches:
            title = re.sub(r'<[^>]+>', '', raw_title).strip()
            if re.search(pattern, href) and len(title) > 25:
                if not href.startswith("http"):
                    href = f"https://{domain}" + href
                articles.append({"title": title, "summary": "", "link": href})

    unique_articles = []
    seen = set()
    for art in articles:
        if art["link"] not in seen:
            seen.add(art["link"])
            unique_articles.append(art)
            
    print(f"📰 Scraped {len(unique_articles)} live stories directly from {domain}")
    return unique_articles[:15]

def search_google_news_rss(query):
    encoded = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={encoded}&hl=en-IN&gl=IN&ceid=IN:en"
    articles = []

    if feedparser:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                pub_date = entry.get("published", "")
                if is_within_last_24h(pub_date):
                    articles.append({
                        "title": entry.get("title", ""),
                        "summary": entry.get("summary", ""),
                        "link": entry.get("link", "")
                    })
            print(f"🔎 Found {len(articles)} RSS results within last 24h for query via feedparser")
            return articles[:10]
        except Exception as e:
            print(f"⚠️ feedparser error: {e}")

    # Fallback to standard XML parsing
    xml_data = fetch_url_text(url)
    if xml_data:
        try:
            root = ET.fromstring(xml_data)
            for item in root.findall('.//item'):
                title = item.findtext('title') or ''
                link = item.findtext('link') or ''
                summary = item.findtext('description') or ''
                pub_date = item.findtext('pubDate') or ''
                if is_within_last_24h(pub_date):
                    articles.append({'title': title, 'summary': summary, 'link': link})
            print(f"🔎 Found {len(articles)} RSS results within last 24h for query via XML parser")
        except Exception as e:
            print(f"⚠️ XML parse error: {e}")

    return articles[:10]

def normalize_brand(name):
    if not name:
        return ""
    clean = re.sub(r'(?i)\b(technologies|technology|tech|pvt|ltd|limited|inc|corp|india|group|solutions|services|platform|labs|app|semi|capital)\b', '', name)
    clean = re.sub(r'[^a-zA-Z0-9]', '', clean).lower()
    return clean if len(clean) >= 3 else name.lower()

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

def build_linkedin_search_url(query):
    import urllib.parse
    encoded = urllib.parse.quote(query)
    return f"https://www.linkedin.com/search/results/people/?keywords={encoded}"

def build_google_search_url(query):
    import urllib.parse
    encoded = urllib.parse.quote(query)
    return f"https://www.google.com/search?q={encoded}"

def post_bdm_daily_hitlist_digest(webhook_url, items):
    if not webhook_url or not webhook_url.startswith("http") or not items:
        print("⚠️ No valid Discord Webhook URL provided or empty hitlist items.")
        return False

    now_ist = datetime.now(IST)
    date_str = now_ist.strftime("%d-%b-%Y").upper()

    header = f"📊 **BDM DAILY HITLIST | {date_str}**"

    lines = []
    lines.append(f"{'COMPANY':<16} | {'STAGE/TYPE':<12} | {'AMOUNT/SCALE':<12} | {'CITY':<10} | {'VC / LEAD'}")
    lines.append("-" * 74)

    quick_links = ["\n**QUICK ACTION LINKS:**"]

    for item in items:
        full_comp = item.get("company", "Company")
        full_stage = item.get("stage_type", "GCC Launch")
        full_amount = item.get("amount_scale", "Undisclosed")
        full_city = item.get("city", "India")
        full_vc = item.get("vc_lead", "Undisclosed")
        news_link = item.get("link", "")

        comp = full_comp[:15]
        stage = full_stage[:12]
        amount = full_amount[:12]
        city = full_city[:10]
        vc = full_vc[:16]

        lines.append(f"{comp:<16} | {stage:<12} | {amount:<12} | {city:<10} | {vc}")

        is_gcc = "gcc" in full_stage.lower()

        if is_gcc:
            lead_q = '"Managing Director" OR "Site Leader" OR "Head of India" OR "Director of Engineering"'
            lead_label = "Site Lead"
            lead_url = build_google_search_url(f'site:linkedin.com/in "{full_comp}" ({lead_q}) "{full_city}"')
        else:
            lead_q = '"Founder" OR "CEO" OR "Chief People Officer" OR "Head of Talent"'
            lead_label = "Founder"
            lead_url = build_google_search_url(f'site:linkedin.com/in "{full_comp}" ({lead_q})')

        link_parts = [f"• **{full_comp}**: [{lead_label}]({lead_url})"]

        if full_vc and full_vc.lower() not in ["undisclosed", "n/a", "none"]:
            vc_url = build_google_search_url(f'site:linkedin.com/in "{full_vc}" ("Talent Partner" OR "Operating Partner" OR "Head of Talent")')
            link_parts.append(f"[VC]({vc_url})")

        if news_link:
            link_parts.append(f"[News]({news_link})")

        quick_links.append(" • ".join(link_parts))

    table_block = "```text\n" + "\n".join(lines) + "\n```"
    full_content = f"{header}\n\n{table_block}\n" + "\n".join(quick_links)

    # Split into chunks if hitlist exceeds 1900 chars
    chunks = []
    if len(full_content) <= 1900:
        chunks = [full_content]
    else:
        chunks.append(f"{header}\n\n{table_block}")
        current_chunk = "**QUICK ACTION LINKS:**\n"
        for ql in quick_links[1:]:
            if len(current_chunk) + len(ql) + 1 > 1800:
                chunks.append(current_chunk)
                current_chunk = ql + "\n"
            else:
                current_chunk += ql + "\n"
        if current_chunk.strip():
            chunks.append(current_chunk)

    headers = {"Content-Type": "application/json"}
    success = True

    for chunk in chunks:
        payload = json.dumps({"content": chunk}).encode('utf-8')
        posted = False
        if requests:
            try:
                res = requests.post(webhook_url, data=payload, headers=headers, timeout=10)
                if res.status_code in [200, 204]:
                    posted = True
            except Exception as e:
                print(f"❌ requests error posting digest to Discord: {e}")

        if not posted:
            try:
                import urllib.request
                req = urllib.request.Request(webhook_url, data=payload, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as res:
                    posted = True
            except Exception as e:
                print(f"❌ urllib error posting digest to Discord: {e}")

        if posted:
            print(f"✅ Posted BDM Daily Hitlist digest chunk to Discord!")
        else:
            success = False

    return success

def post_to_discord(webhook_url, title, summary, link, company_name, city, lead_type, company_website="", key_people=None):
    if not webhook_url or not webhook_url.startswith("http"):
        print("⚠️ No valid Discord Webhook URL provided. Skipping Discord alert.")
        return False

    now_ist = datetime.now(IST)
    ist_str = now_ist.strftime("%d %b %Y, %I:%M %p IST")
    comp = company_name or "Company"

    # 1. Official Website URL Link
    if company_website:
        clean_web = company_website.strip()
        web_url = clean_web if clean_web.startswith("http") else f"https://{clean_web}"
        website_val = f"🔗 [{clean_web}]({web_url})"
    else:
        google_web_search = build_google_search_url(f"{comp} official website")
        website_val = f"🔍 [Search {comp} Official Website]({google_web_search})"

    # 2. LinkedIn Leadership Profile Links
    people_lines = []
    if key_people and isinstance(key_people, list):
        for person in key_people[:3]:
            p_clean = str(person).strip()
            if p_clean and p_clean.lower() != "none":
                li_url = build_linkedin_search_url(f"{p_clean} {comp}")
                people_lines.append(f"• **{p_clean}**: [LinkedIn Search]({li_url})")

    main_li_search = build_linkedin_search_url(f"{comp} Founder OR GCC Head OR Vice President")
    people_lines.append(f"• 👔 [Find {comp} Leadership on LinkedIn]({main_li_search})")
    
    linkedin_val = "\n".join(people_lines)

    fields = [
        {"name": "🏢 Company", "value": comp, "inline": True},
        {"name": "📍 Hub / City", "value": city or "India / APAC", "inline": True},
        {"name": "🏷️ Category", "value": lead_type or "GCC Expansion", "inline": True},
        {"name": "📰 Source Article", "value": f"🔗 [Read Full News Article]({link})" if link else "N/A", "inline": False},
        {"name": "🌐 Official Website", "value": website_val, "inline": False},
        {"name": "💼 Executive LinkedIn Profiles", "value": linkedin_val, "inline": False},
        {"name": "🕒 Signal Time (IST)", "value": ist_str, "inline": False}
    ]

    embed = {
        "title": f"📡 GCC Leadership Radar Alert: {comp}",
        "description": summary[:1000] if summary else title,
        "url": link,
        "color": 3447003 if "GCC" in str(lead_type) else 15105570,
        "fields": fields,
        "footer": {"text": "GCC Leadership Radar • IST (Asia/Kolkata)"},
        "timestamp": now_ist.isoformat()
    }

    payload = json.dumps({"content": "⚡ **New GCC Leadership Radar Signal Detected!**", "embeds": [embed]}).encode('utf-8')
    headers = {"Content-Type": "application/json"}

    if requests:
        try:
            res = requests.post(webhook_url, data=payload, headers=headers, timeout=10)
            if res.status_code in [200, 204]:
                print(f"✅ Posted alert to Discord for {comp}")
                return True
        except Exception as e:
            print(f"❌ requests error posting to Discord: {e}")

    try:
        import urllib.request
        req = urllib.request.Request(webhook_url, data=payload, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as res:
            print(f"✅ Posted alert to Discord for {comp} via urllib")
            return True
    except Exception as e:
        print(f"❌ urllib error posting to Discord: {e}")

    return False

def analyze_story_with_ai(title, summary, link):
    brand_hint = title.split("-")[0].split("|")[0].split(":")[0].strip()
    clean_brand = normalize_brand(brand_hint)

    if not groq_client:
        return {
            "company": brand_hint[:30],
            "brand_key": clean_brand,
            "city": "India",
            "stage_type": "GCC Expansion",
            "amount_scale": "Undisclosed",
            "vc_lead": "Undisclosed",
            "summary": title,
            "relevant": True,
            "link": link
        }

    prompt = f"""Extract structured GCC or tech company expansion/funding details from this news story:
Title: {title}
Summary: {summary}

Respond ONLY with raw JSON in this format:
{{
  "is_relevant": true,
  "company_name": "Company Name",
  "company_website": "official website domain or leave empty",
  "city": "City or Region e.g. Pune, Bangalore, Hyderabad, India",
  "stage_type": "Series A | Series B | Seed | Debt | New GCC | GCC Expansion | Office Lease",
  "amount_scale": "$12M or ₹100 Cr or 50,000 sq ft or Undisclosed",
  "vc_lead": "VC Fund / Lead Investor / Partner Name or Undisclosed",
  "brief_summary": "1 sentence executive summary of the signal"
}}"""

    models_to_try = [
        MODEL_NAME,             # 1. Primary: openai/gpt-oss-120b (120B top intelligence)
        "qwen/qwen3.8-27b",      # 2. Fallback 1: Qwen 3.8 27B (High accuracy entity extraction)
        "qwen/qwen3.6-27b",      # 3. Fallback 2: Qwen 3.6 27B
        "groq/compound",         # 4. Fallback 3: Groq Compound Router
        "openai/gpt-oss-20b"     # 5. Fallback 4: GPT-OSS 20B
    ]
    for model in models_to_try:
        try:
            time.sleep(1.2)  # Throttle to respect Groq free tier TPM limits
            response = groq_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=500
            )
            content = response.choices[0].message.content.strip()
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                parsed = json.loads(match.group(0))
                company = parsed.get("company_name", brand_hint[:30])
                brand_key = normalize_brand(company) or clean_brand
                return {
                    "company": company,
                    "company_website": parsed.get("company_website", ""),
                    "brand_key": brand_key,
                    "city": parsed.get("city", "India"),
                    "stage_type": parsed.get("stage_type", "GCC Expansion"),
                    "amount_scale": parsed.get("amount_scale", "Undisclosed"),
                    "vc_lead": parsed.get("vc_lead", "Undisclosed"),
                    "summary": parsed.get("brief_summary", title),
                    "relevant": parsed.get("is_relevant", True),
                    "link": link
                }
        except Exception as e:
            if "429" in str(e) or "rate_limit" in str(e).lower():
                print(f"⏳ Groq rate limit encountered. Waiting 3s before retry with fallback model...")
                time.sleep(3.0)
            else:
                print(f"⚠️ Groq AI analysis error: {e}")

    return {
        "company": brand_hint[:30],
        "brand_key": clean_brand,
        "city": "India",
        "stage_type": "GCC Expansion",
        "amount_scale": "Undisclosed",
        "vc_lead": "Undisclosed",
        "summary": title,
        "relevant": True,
        "link": link
    }

def run_gcc_radar():
    print("📡 Starting GCC Leadership Radar Tracker...")
    all_articles = []

    # 1. Scrape direct webpages
    for site in WEBSITES_TO_SCRAPE:
        arts = scrape_direct_webpage(site)
        all_articles.extend(arts)

    # 2. Search Google RSS queries
    for q in SEARCH_QUERIES:
        arts = search_google_news_rss(q)
        all_articles.extend(arts)

    print(f"📊 Total collected stories across all sources: {len(all_articles)}")
    processed_count = 0
    new_signals = 0
    new_hitlist_items = []

    for article in all_articles:
        title = article.get("title", "")
        summary = article.get("summary", "")
        link = article.get("link", "")
        combined_text = (title + " " + summary).lower()

        # Check trigger keywords
        if not any(kw in combined_text for kw in TRIGGER_KEYWORDS):
            continue

        processed_count += 1
        analysis = analyze_story_with_ai(title, summary, link)

        if not analysis.get("relevant"):
            continue

        brand_key = analysis.get("brand_key")
        company = analysis.get("company")
        city = analysis.get("city")
        lead_type = analysis.get("stage_type", "GCC Expansion")
        exec_summary = analysis.get("summary") or title

        print(f"\n✨ [AI Extracted Signal #{processed_count}]")
        print(f"   🏢 Company  : {company}")
        print(f"   📍 Hub/City : {city}")
        print(f"   🏷️ Category : {lead_type}")
        print(f"   💰 Amount   : {analysis.get('amount_scale')}")
        print(f"   🤝 VC / Lead: {analysis.get('vc_lead')}")
        print(f"   📝 Summary  : {exec_summary}")
        print(f"   🔗 URL      : {link}")

        if is_brand_processed(brand_key):
            print(f"   ⏭️ Status   : Previously seen in database (deduplicated)")
            continue
        else:
            print(f"   ✅ Status   : NEW Lead Signal! (Added to BDM Daily Hitlist)")

        # Mark processed in SQLite
        mark_brand_processed(brand_key, company, city)

        new_hitlist_items.append(analysis)
        new_signals += 1

    # Post BDM Daily Hitlist Digest to Discord
    if new_hitlist_items and DISCORD_WEBHOOK_URL:
        print(f"\n🚀 Posting BDM Daily Hitlist Digest with {len(new_hitlist_items)} new leads to Discord...")
        post_bdm_daily_hitlist_digest(DISCORD_WEBHOOK_URL, new_hitlist_items)

    print(f"✨ GCC Leadership Radar Run Complete. Relevant Signals Evaluated: {processed_count}, New Alerts Sent: {new_signals}")

if __name__ == "__main__":
    run_gcc_radar()
