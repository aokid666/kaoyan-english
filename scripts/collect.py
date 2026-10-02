#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
考研英语一 · 每日写作素材收集

流程：抓 RSS → （可选）AI 提炼成观点/论据/关键词 → 写入 data/ideas.json
      没有配置 AI_API_KEY 时降级为纯标题收集，流程照常跑通。

环境变量：
  AI_API_KEY   API 密钥（不配则跳过 AI 提炼）
  AI_BASE_URL  OpenAI 兼容地址，默认 https://api.deepseek.com/v1
  AI_MODEL     模型名，默认 deepseek-chat
  MAX_ITEMS    每天最多收录几条（默认 6）
  AI_PICK      喂给 AI 的候选条数（默认 40）
"""
import os, json, re, sys, time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATADIR = os.path.join(ROOT, 'data')
DATA = os.path.join(DATADIR, 'ideas.json')
CST = timezone(timedelta(hours=8))
UA = 'Mozilla/5.0 (compatible; kaoyan-ideas/1.0; +https://aokid666.github.io/)'
KEEP_DAYS = 400

TOPICS = ['个人成长与学习', '人际与家庭', '文化与社会参与', '科技与日常使用',
          '公共服务与生活质量', '就业与能力发展', '环境与健康生活']

SOURCES = [
    ('BBC News',          'https://feeds.bbci.co.uk/news/rss.xml'),
    ('BBC 教育',           'https://feeds.bbci.co.uk/news/education/rss.xml'),
    ('The Guardian',      'https://www.theguardian.com/world/rss'),
    ('Guardian 教育',      'https://www.theguardian.com/education/rss'),
    ('Guardian 科技',      'https://www.theguardian.com/technology/rss'),
    ('Guardian 环境',      'https://www.theguardian.com/environment/rss'),
    ('Guardian 社会',      'https://www.theguardian.com/society/rss'),
    ('NPR',               'https://feeds.npr.org/1001/rss.xml'),
    ('ScienceDaily',      'https://www.sciencedaily.com/rss/all.xml'),
    ('The Conversation',  'https://theconversation.com/articles.atom'),
    ('UN News',           'https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
    ('WHO',               'https://www.who.int/rss-feeds/news-english.xml'),
]


def log(*a):
    print(*a, flush=True)


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def strip_html(s):
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s or '', flags=re.S | re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = (s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
          .replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' '))
    return re.sub(r'\s+', ' ', s).strip()


def parse_feed(raw, source):
    out = []
    try:
        root = ET.fromstring(raw)
    except Exception as e:
        log('  解析失败 %s: %s' % (source, e))
        return out
    for it in root.iter():
        if it.tag.split('}')[-1] not in ('item', 'entry'):
            continue
        t = link = desc = pub = ''
        for ch in it:
            n = ch.tag.split('}')[-1]
            if n == 'title' and not t:
                t = strip_html(ch.text or '')
            elif n == 'link' and not link:
                link = (ch.text or '').strip() or ch.attrib.get('href', '')
            elif n in ('description', 'summary', 'content') and not desc:
                desc = strip_html(''.join(ch.itertext()))[:500]
            elif n in ('pubDate', 'published', 'updated') and not pub:
                pub = (ch.text or '').strip()
        if t and link:
            out.append({'source': source, 'title': t, 'summary': desc,
                        'link': link, 'published': pub})
    return out


PROMPT = """你是考研英语一写作素材编辑。下面是从外媒刚抓到的报道，编号列出。

请挑出最适合做考研英语一写作素材的 {n} 条，按七类主题归类（只能从这七类里选）：
{tp}

每条产出以下字段：
- idx：对应上面列表的编号（整数）
- topic：七类之一
- title_zh：中文标题，不超过 20 字
- summary_zh：2 句话讲清「现象是什么」，具体、不要口号
- angles：1—2 个可展开的中文观点，各 25 字内，要带因果或条件（例：因为…所以…／前提是…）
- evidence：可直接引用的论据列表（数字、机构、年份、研究结论），没有就给空数组
- keywords：3—5 个英文高频搭配（名词短语或动名词短语）
- essay_type：大作文 / 小作文 / 通用

要求：优先选有具体数据、社会现象、教育/科技/环境/就业类的报道；避开纯政治、灾难、绯闻、体育比分。
只输出 JSON，格式：{{"items":[{{...}}]}}

候选报道：
{listing}
"""


def ai_enrich(items, n):
    key = (os.environ.get('AI_API_KEY') or '').strip()
    if not key:
        log('未配置 AI_API_KEY → 跳过 AI 提炼（只收标题）')
        return None
    base = (os.environ.get('AI_BASE_URL') or 'https://api.deepseek.com/v1').rstrip('/')
    model = (os.environ.get('AI_MODEL') or 'deepseek-chat').strip()
    listing = '\n'.join(
        '[%d] (%s) %s :: %s' % (i, it['source'], it['title'], it['summary'][:220])
        for i, it in enumerate(items))
    prompt = PROMPT.format(n=n, tp='、'.join(TOPICS), listing=listing)
    body = {'model': model, 'temperature': 0.4,
            'messages': [{'role': 'user', 'content': prompt}],
            'response_format': {'type': 'json_object'}}
    req = urllib.request.Request(
        base + '/chat/completions', data=json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    log('调用 %s @ %s ...' % (model, base))
    with urllib.request.urlopen(req, timeout=240) as r:
        d = json.loads(r.read())
    txt = d['choices'][0]['message']['content']
    m = re.search(r'\{.*\}', txt, re.S)
    data = json.loads(m.group(0) if m else txt)
    out = []
    for x in data.get('items', [])[:n]:
        i = x.get('idx')
        src = items[i] if isinstance(i, int) and 0 <= i < len(items) else {}
        tp = x.get('topic') if x.get('topic') in TOPICS else '待分类'
        out.append({
            'topic': tp,
            'title_zh': (x.get('title_zh') or src.get('title', ''))[:60],
            'summary_zh': x.get('summary_zh', ''),
            'angles': x.get('angles', [])[:2],
            'evidence': x.get('evidence', [])[:5],
            'keywords': x.get('keywords', [])[:6],
            'essay_type': x.get('essay_type', '通用'),
            'source': src.get('source', ''),
            'source_title': src.get('title', ''),
            'url': src.get('link', ''),
            'published': src.get('published', ''),
        })
    log('AI 提炼出 %d 条' % len(out))
    return out


def load_data():
    if os.path.exists(DATA):
        with open(DATA, encoding='utf-8') as f:
            return json.load(f)
    return {'version': 1, 'updated': '', 'days': []}


def main():
    today = datetime.now(CST).strftime('%Y-%m-%d')
    force = '--force' in sys.argv
    n = int(os.environ.get('MAX_ITEMS', '6'))
    pick = int(os.environ.get('AI_PICK', '40'))

    data = load_data()
    if not force and any(d['date'] == today for d in data['days']):
        log('今天（%s）已有记录，跳过。加 --force 可重跑。' % today)
        return

    log('开始抓取 %d 个源 ...' % len(SOURCES))
    raw_items = []
    for name, url in SOURCES:
        try:
            feed = parse_feed(http_get(url), name)
            raw_items.extend(feed)
            log('  OK  %-16s %d 条' % (name, len(feed)))
        except Exception as e:
            log('  --  %-16s 失败：%s' % (name, str(e)[:90]))
        time.sleep(0.4)

    seen, uniq = set(), []
    for it in raw_items:
        k = re.sub(r'\W+', '', it['title'].lower())[:60]
        if k and k not in seen:
            seen.add(k)
            uniq.append(it)
    log('去重后共 %d 条' % len(uniq))

    items = None
    try:
        items = ai_enrich(uniq[:pick], n)
    except Exception as e:
        log('AI 提炼失败：%s' % str(e)[:200])

    if not items:
        log('降级：只保存原始标题')
        items = [{
            'topic': '待分类', 'title_zh': it['title'], 'summary_zh': it['summary'][:160],
            'angles': [], 'evidence': [], 'keywords': [], 'essay_type': '通用',
            'source': it['source'], 'source_title': it['title'],
            'url': it['link'], 'published': it['published'],
        } for it in uniq[:n]]

    for it in items:
        it['collected_at'] = datetime.now(CST).strftime('%Y-%m-%d %H:%M')

    entry = {'date': today, 'generated_at': datetime.now(CST).isoformat(timespec='seconds'),
             'ai': bool((os.environ.get('AI_API_KEY') or '').strip()),
             'model': os.environ.get('AI_MODEL', '') if os.environ.get('AI_API_KEY') else '',
             'count': len(items), 'items': items}

    data['days'] = [d for d in data['days'] if d['date'] != today]
    data['days'].append(entry)
    data['days'].sort(key=lambda d: d['date'], reverse=True)
    data['days'] = data['days'][:KEEP_DAYS]
    data['updated'] = entry['generated_at']

    os.makedirs(DATADIR, exist_ok=True)
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log('已写入 %s（%d 条，累计 %d 天）' % (DATA, len(items), len(data['days'])))

    with open(os.environ.get('GITHUB_STEP_SUMMARY', '/dev/null'), 'a', encoding='utf-8') as f:
        f.write('## 每日写作素材 · %s\n\n' % today)
        for it in items:
            f.write('- **[%s]** %s — %s\n' % (it['topic'], it['title_zh'], it['summary_zh'][:60]))
        if not entry['ai']:
            f.write('\n> 未配置 AI_API_KEY，本次只收集了原始标题。\n')


if __name__ == '__main__':
    main()
