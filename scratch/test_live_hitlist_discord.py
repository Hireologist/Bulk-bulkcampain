import sys, os
sys.path.append(os.path.abspath('.'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from gcc_tracker import post_bdm_daily_hitlist_digest

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
        "link": "https://news.google.com/rss/articles/sample_hcl"
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

print("🧪 Testing BDM Daily Hitlist digest layout generation...")
# Test formatting without webhook
post_bdm_daily_hitlist_digest("", sample_items)
print("✅ Format test finished successfully.")
