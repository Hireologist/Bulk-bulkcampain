import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import urllib.parse
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

sample_items = [
    {
        "company": "InstaAstro",
        "stage_type": "Series A",
        "amount_scale": "$12M",
        "city": "India",
        "vc_lead": "Singularity AMC",
        "link": "https://economictimes.indiatimes.com/tech/funding/faithtech-startup-instaastro-raises-12-million-in-round-led-by-singularity-amc/articleshow/133557338.cms"
    },
    {
        "company": "HCLTech",
        "stage_type": "New GCC",
        "amount_scale": "Undisclosed",
        "city": "Pune",
        "vc_lead": "Undisclosed",
        "link": "https://news.google.com/rss/articles/CBMigwFBVV95cUxNaVZVYjVOR3h1dzZDaXhDNS1LZ3VaZTJuRlpPNXFmNnpfYWZJMzNhcUQ4LVo0TjBSV2swWVY0V0FKelpNcldvMGZzN1NiRzZSdHFQdFc5eVJBdzIyLTBxbUxjd1RWeFZSbF9NTnlYcWpUc3ctQU80U2FseWItM1lZeHhvTQ?oc=5"
    },
    {
        "company": "OORJAA",
        "stage_type": "Series A",
        "amount_scale": "Undisclosed",
        "city": "India",
        "vc_lead": "Equentis Angel Fund",
        "link": "https://news.google.com/rss/articles/sample_oorjaa"
    },
    {
        "company": "Ringg",
        "stage_type": "Series A",
        "amount_scale": "Undisclosed",
        "city": "Bangalore",
        "vc_lead": "Peak XV",
        "link": "https://news.google.com/rss/articles/sample_ringg"
    },
    {
        "company": "Kolors Health",
        "stage_type": "Debt",
        "amount_scale": "Undisclosed",
        "city": "India",
        "vc_lead": "Piramal Alts",
        "link": "https://news.google.com/rss/articles/sample_kolors"
    }
]

def generate_google_search_url(company, query):
    q = f'site:linkedin.com/in "{company}" ({query})'
    return f"https://www.google.com/search?q={urllib.parse.quote(q)}"

def build_bdm_digest_payload(items):
    now_ist = datetime.now(IST)
    date_str = now_ist.strftime("%d-%b-%Y").upper()

    header = f"📊 **BDM DAILY HITLIST | {date_str}**"

    # Build ASCII alignment table
    lines = []
    lines.append(f"{'COMPANY':<16} | {'STAGE/TYPE':<12} | {'AMOUNT/SCALE':<12} | {'CITY':<10} | {'VC / LEAD'}")
    lines.append("-" * 74)

    quick_links = ["\n**QUICK ACTION LINKS:**"]

    for item in items:
        comp = item["company"][:15]
        stage = item["stage_type"][:12]
        amount = item["amount_scale"][:12]
        city = item["city"][:10]
        vc = item["vc_lead"][:16]

        lines.append(f"{comp:<16} | {stage:<12} | {amount:<12} | {city:<10} | {vc}")

        # Quick action links building
        full_comp = item["company"]
        full_stage = item["stage_type"]
        full_vc = item["vc_lead"]
        news_link = item.get("link", "")

        is_gcc = "gcc" in full_stage.lower()

        if is_gcc:
            lead_q = '"Managing Director" OR "Site Leader" OR "Head of India" OR "Director of Engineering"'
            lead_label = "Site Lead"
        else:
            lead_q = '"Founder" OR "CEO" OR "Chief People Officer" OR "Head of Talent"'
            lead_label = "Founder"

        lead_url = generate_google_search_url(full_comp, lead_q)
        link_parts = [f"• **{full_comp}**: [{lead_label}]({lead_url})"]

        if full_vc and full_vc.lower() not in ["undisclosed", "n/a", "none"]:
            vc_url = generate_google_search_url(full_vc, '"Talent Partner" OR "Operating Partner" OR "Head of Talent"')
            link_parts.append(f"[VC]({vc_url})")

        if news_link:
            link_parts.append(f"[News]({news_link})")

        quick_links.append(" • ".join(link_parts))

    table_block = "```text\n" + "\n".join(lines) + "\n```"
    digest_message = f"{header}\n\n{table_block}\n" + "\n".join(quick_links)
    return digest_message

msg = build_bdm_digest_payload(sample_items)
print(msg)
