import sys, zipfile, json, re, io
z = zipfile.ZipFile(sys.argv[1]); names = z.namelist(); r = {'files': names, 'ok_zip': z.testzip() is None}
ex = [n for n in names if n.startswith('EXTF_')][0]; raw = z.read(ex)
r['crlf'] = b'\r\n' in raw and raw.count(b'\n') == raw.count(b'\r\n')
try: txt = raw.decode('cp1252'); r['cp1252'] = True
except Exception: txt = raw.decode('latin-1'); r['cp1252'] = False
lines = txt.split('\r\n'); h = lines[0].split(';'); cols = lines[1].split(';')
r['extf_header'] = h[0] == '"EXTF"' and h[1] == '700' and h[2] == '21' and h[3] == '"Buchungsstapel"' and h[4] == '13' and len(h) >= 31
r['consultant'], r['client'], r['cols'] = h[10], h[11], len(cols)
r['skr'] = h[26] if len(h) > 26 else ''
def cents(s): return int(round(float(s.replace('.', '').replace(',', '.')) * 100))
rev = 0; tips = 0; bu_ok = True
m = re.search(r'SKR0?(\d)', ex); skr = ex.split('_')[-1].split('.')[0]
REV = {'SKR03': ('8400', '8300', '8200'), 'SKR04': ('4400', '4300', '4200')}[skr]
TIP = {'SKR03': '1590', 'SKR04': '1370'}[skr]
for ln in lines[2:]:
    if not ln.strip(): continue
    f = ln.split(';'); amt = cents(f[0]); sh = f[1].strip('"'); konto, gegen = f[6], f[7]
    sign = 1 if sh == 'S' else -1
    # Erlös = Haben auf Erlöskonto
    if konto in REV: rev -= sign * amt
    if gegen in REV: rev += sign * amt
    if gegen == TIP and konto != TIP and 'Trinkgeld' in f[13]:
        tips += sign * amt
        if f[8].strip('"'): bu_ok = False
r['revenue_cents'] = rev; r['tips_cents'] = tips if bu_ok else -1
rp = [n for n in names if n.startswith('Monatsbericht')][0]; html = z.read(rp).decode('utf-8')
g = f"{rev/100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
r['report_has_gross'] = g in html
tx = [n for n in names if n.startswith('Transaktionen')][0]; t = z.read(tx).decode('utf-8-sig')
rows = t.strip().split('\r\n') if '\r\n' in t else t.strip().split('\n'); r['tx_rows'] = len(rows) - 1
r['tx_injection_safe'] = not any(re.search(r'(^|;)"?[=+@]', ln) for ln in rows[1:])
print(json.dumps(r))
