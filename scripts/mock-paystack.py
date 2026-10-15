"""Local stand-in for the Paystack API, for demos and app testing without a
Paystack account. Never use in production.

    python3 scripts/mock-paystack.py            # listens on 127.0.0.1:3996
    PAYSTACK_BASE_URL=http://127.0.0.1:3996 npm run start:dev

Implements the calls the backend makes: transaction initialize/verify, plan,
subscription create/fetch/disable. Checkout pages have Pay and Decline
buttons; both return to the transaction's callback_url like Paystack does.
"""
import html, json, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 3996
tx = {}  # reference -> transaction
# Seconds before checkout pages press Pay by themselves; 0 = wait for a tap.
# Tests and demo recordings turn it on with GET /__autopay?seconds=N.
settings = {"autopay": 0.0}
counter = {"plan": 0, "sub": 0}


def ok(data):
    return {"status": True, "message": "ok", "data": data}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/transaction/initialize":
            b = self._body()
            ref = b.get("reference") or f"MOCK{int(time.time()*1000)}"
            tx[ref] = {
                "reference": ref, "amount": int(b.get("amount", 0)), "currency": "NGN",
                "email": b.get("email", ""), "metadata": b.get("metadata"), "plan": b.get("plan"),
                "callback_url": b.get("callback_url"), "status": "pending", "paid_at": None,
            }
            return self._json(200, ok({
                "authorization_url": f"http://127.0.0.1:{PORT}/checkout/{urllib.parse.quote(ref)}",
                "access_code": f"AC_{ref}", "reference": ref,
            }))
        if path.startswith("/checkout/") and path.endswith(("/pay", "/decline")):
            ref = urllib.parse.unquote(path.split("/")[2])
            t = tx.get(ref)
            if not t:
                return self._json(404, {"status": False, "message": "Unknown transaction"})
            paid = path.endswith("/pay")
            t["status"] = "success" if paid else "failed"
            t["paid_at"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()) if paid else None
            back = t.get("callback_url") or "about:blank"
            sep = "&" if "?" in back else "?"
            self.send_response(303)
            self.send_header("Location", f"{back}{sep}reference={urllib.parse.quote(ref)}&trxref={urllib.parse.quote(ref)}")
            self.end_headers()
            return
        if path == "/plan":
            counter["plan"] += 1
            return self._json(200, ok({"plan_code": f"PLN_mock_{counter['plan']}"}))
        if path == "/subscription":
            counter["sub"] += 1
            return self._json(200, ok({"subscription_code": f"SUB_mock_{counter['sub']}", "email_token": "mock_token"}))
        if path == "/subscription/disable":
            return self._json(200, {"status": True, "message": "Subscription disabled"})
        return self._json(404, {"status": False, "message": f"Not mocked: POST {path}"})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/__autopay":
            q = urllib.parse.parse_qs(parsed.query)
            settings["autopay"] = float((q.get("seconds") or ["0"])[0])
            return self._json(200, {"autopay": settings["autopay"]})
        if path.startswith("/transaction/verify/"):
            ref = urllib.parse.unquote(path.rsplit("/", 1)[1])
            t = tx.get(ref)
            if not t:
                return self._json(400, {"status": False, "message": "Transaction reference not found"})
            return self._json(200, ok({
                "status": t["status"], "reference": ref, "amount": t["amount"], "currency": "NGN",
                "paid_at": t["paid_at"], "metadata": t["metadata"], "plan": t["plan"],
                "customer": {"customer_code": "CUS_mock", "email": t["email"]},
                "authorization": {"authorization_code": "AUTH_mock"},
            }))
        if path.startswith("/subscription/"):
            code = path.rsplit("/", 1)[1]
            return self._json(200, ok({"subscription_code": code, "email_token": "mock_token"}))
        if path.startswith("/checkout/"):
            ref = urllib.parse.unquote(path.split("/")[2])
            t = tx.get(ref)
            if not t:
                self.send_response(404); self.end_headers(); return
            naira = f"₦{t['amount'] / 100:,.2f}"
            page = f"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<title>Test checkout</title><style>
body{{margin:0;font:16px -apple-system,system-ui,sans-serif;background:#f3f6f5;color:#10231f;display:grid;place-items:center;min-height:100vh}}
.card{{background:#fff;border-radius:20px;padding:28px 24px;width:min(360px,88vw);box-shadow:0 10px 30px rgba(16,35,31,.08)}}
.tag{{display:inline-block;background:#fff2e1;color:#b86e0b;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:.04em}}
h1{{font-size:30px;margin:14px 0 4px}} p{{color:#4b605b;margin:0 0 6px;font-size:14px}}
.card-box{{background:#eff4f2;border-radius:14px;padding:14px;margin:18px 0;font-size:14px;color:#4b605b}}
button{{width:100%;border:0;border-radius:14px;padding:16px;font-size:16px;font-weight:700;margin-top:10px}}
.pay{{background:#0ba4db;color:#fff}} .decline{{background:#fff;color:#c8423c;border:1.5px solid #f2d0cd}}
</style></head><body><form class=card method=post>
<span class=tag>TEST MODE · LOCAL</span><h1>{naira}</h1><p>{html.escape(t['email'])}</p>
<div class=card-box>Card 4084 0840 8408 4081 · 12/30 · CVV 408<br>Paystack test card, no money moves.</div>
<button class=pay formaction="/checkout/{urllib.parse.quote(ref)}/pay">Pay {naira}</button>
<button class=decline formaction="/checkout/{urllib.parse.quote(ref)}/decline">Decline</button>
</form>{autopay_script()}</body></html>"""
            raw = page.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        return self._json(404, {"status": False, "message": f"Not mocked: GET {path}"})


def autopay_script():
    secs = settings["autopay"]
    if secs <= 0:
        return ""
    # Highlight Pay so a recording shows what happens, then press it.
    return f"""<script>
setTimeout(function(){{var b=document.querySelector('.pay');b.style.transition='transform .25s, box-shadow .25s';
b.style.boxShadow='0 0 0 6px rgba(11,164,219,.25)';b.style.transform='scale(.97)';
setTimeout(function(){{b.click();}},450);}},{int(secs * 1000)});
</script>"""


if __name__ == "__main__":
    print(f"Mock Paystack on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
