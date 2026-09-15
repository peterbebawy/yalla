"""Yalla Toktok: Flask API, transactional SQLite storage and static client."""
import os, re, json, time, math, sqlite3, secrets, hashlib
from pathlib import Path
from functools import wraps
from flask import Flask, request, g, jsonify, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

ROOT = Path(__file__).parent
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024
DB_PATH = os.environ.get('DATABASE_PATH', str(ROOT / 'data' / 'toktok.sqlite'))
ALLOWED_ORIGINS = {x.strip().rstrip('/') for x in os.environ.get('ALLOWED_ORIGINS', '').split(',') if x.strip()}
ACTIVE = ('searching', 'accepted', 'arrived', 'in_progress')

def db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys=ON')
    return g.db

@app.teardown_appcontext
def close_db(_):
    if 'db' in g:
        g.db.close()

def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL, role TEXT NOT NULL, vehicle TEXT DEFAULT '',
          approved INTEGER DEFAULT 0, online INTEGER DEFAULT 0,
          lat REAL, lng REAL, location_at REAL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS trips (
          id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES users(id),
          driver_id INTEGER REFERENCES users(id), pickup TEXT NOT NULL, destination TEXT NOT NULL,
          lat REAL, lng REAL, dest_lat REAL, dest_lng REAL, price REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'searching', code TEXT NOT NULL,
          note TEXT DEFAULT '', created REAL NOT NULL, updated REAL NOT NULL,
          cancelled_reason TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS offers (
          id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id),
          driver_id INTEGER NOT NULL REFERENCES users(id), price REAL NOT NULL, created REAL NOT NULL,
          UNIQUE(trip_id,driver_id));
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id),
          user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS ratings (
          trip_id INTEGER NOT NULL REFERENCES trips(id), user_id INTEGER NOT NULL REFERENCES users(id),
          target_id INTEGER NOT NULL REFERENCES users(id), stars INTEGER NOT NULL, comment TEXT DEFAULT '',
          UNIQUE(trip_id,user_id));
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          trip_id INTEGER REFERENCES trips(id), body TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER, reset REAL);
        CREATE INDEX IF NOT EXISTS trip_status ON trips(status,created);
        CREATE INDEX IF NOT EXISTS message_trip ON messages(trip_id,id);
        ''')

class ApiError(Exception):
    def __init__(self, message, status=400): self.message, self.status = message, status

@app.errorhandler(ApiError)
def api_error(e): return jsonify(error=e.message), e.status

@app.errorhandler(413)
def too_large(e): return jsonify(error='الطلب أكبر من الحد المسموح'), 413

@app.before_request
def before():
    if request.path.startswith('/api/'):
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/') and origin.rstrip('/') not in ALLOWED_ORIGINS:
            raise ApiError('هذا الموقع غير مصرح له بالاتصال', 403)
        if request.method == 'OPTIONS': return '', 204

@app.after_request
def headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; "
        "connect-src 'self'; frame-src https://www.openstreetmap.org; "
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    response.headers['Permissions-Policy'] = 'geolocation=(self), camera=(), microphone=()'
    if os.environ.get('ENABLE_HSTS') == '1':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
        origin = request.headers.get('Origin', '').rstrip('/')
        if origin in ALLOWED_ORIGINS:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

def data():
    result = request.get_json(silent=True)
    if not isinstance(result, dict): raise ApiError('بيانات الطلب غير صحيحة')
    return result

def text_value(d, key, minimum=1, maximum=180):
    value = str(d.get(key, '')).strip()
    if not minimum <= len(value) <= maximum: raise ApiError('راجع حقل ' + key)
    return value

def price_value(value):
    try: value = round(float(value), 2)
    except (TypeError, ValueError): raise ApiError('أدخل سعرًا صحيحًا')
    if not math.isfinite(value) or not 5 <= value <= 5000: raise ApiError('السعر من 5 إلى 5000 جنيه')
    return value

def coordinates(d, a='lat', b='lng', required=False):
    if d.get(a) in (None, '') and d.get(b) in (None, '') and not required: return None, None
    try: lat, lng = float(d[a]), float(d[b])
    except (KeyError, ValueError, TypeError): raise ApiError('إحداثيات الموقع غير صحيحة')
    if not math.isfinite(lat) or not math.isfinite(lng) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ApiError('إحداثيات الموقع خارج النطاق')
    return lat, lng

def public_user(u):
    return {k: u[k] for k in ('id', 'name', 'phone', 'role', 'vehicle', 'approved', 'online')}

def auth(*roles):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            token = request.headers.get('Authorization', '').removeprefix('Bearer ')
            hashed = hashlib.sha256(token.encode()).hexdigest()
            g.user = db().execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?', (hashed,time.time())).fetchone()
            if not g.user: raise ApiError('سجل الدخول أولًا', 401)
            if roles and g.user['role'] not in roles: raise ApiError('لا تملك صلاحية هذا الإجراء',403)
            return fn(*args, **kwargs)
        return wrapped
    return decorate

def rate_limit():
    key = request.remote_addr + ':' + request.path
    now = time.time()
    c = db()
    c.execute('BEGIN IMMEDIATE')
    c.execute('DELETE FROM rate_limits WHERE reset<?', (now,))
    c.execute('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key,now+900))
    count = c.execute('SELECT count FROM rate_limits WHERE key=?',(key,)).fetchone()[0]
    c.commit()
    if count > 30: raise ApiError('محاولات كثيرة؛ جرّب بعد 15 دقيقة',429)

def session_for(u):
    token = secrets.token_urlsafe(32)
    db().execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
    db().execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],time.time()+7*86400))
    db().commit()
    return jsonify(user=public_user(u), token=token)

@app.post('/api/register')
def register():
    rate_limit()
    d = data()
    name = text_value(d,'name',2,70)
    phone = text_value(d,'phone',8,18)
    if not re.fullmatch(r'\+?[0-9]{8,15}',phone): raise ApiError('اكتب رقم الهاتف بالأرقام الإنجليزية مع كود الدولة')
    password = text_value(d,'password',8,128)
    role = d.get('role')
    if role not in ('customer','driver'): raise ApiError('اختار عميل أو دريفر')
    vehicle = text_value(d,'vehicle',2,40) if role == 'driver' else ''
    try:
        cur = db().execute('INSERT INTO users(name,phone,password,role,vehicle,approved,created) VALUES (?,?,?,?,?,?,?)',
             (name,phone,generate_password_hash(password),role,vehicle,int(role=='customer'),time.time()))
        db().commit()
    except sqlite3.IntegrityError: raise ApiError('رقم الهاتف مسجل بالفعل')
    return session_for(db().execute('SELECT * FROM users WHERE id=?',(cur.lastrowid,)).fetchone())

@app.post('/api/login')
def login():
    rate_limit()
    d = data()
    u = db().execute('SELECT * FROM users WHERE phone=?',(text_value(d,'phone',8,18),)).fetchone()
    password = text_value(d,'password',1,128)
    valid = check_password_hash(u['password'] if u else DUMMY_PASSWORD,password)
    if not u or not valid: raise ApiError('رقم الهاتف أو كلمة المرور غير صحيحة',401)
    if u['role'] != 'admin' and u['role'] != d.get('role'): raise ApiError('اختار نوع الحساب الصحيح')
    return session_for(u)

@app.post('/api/logout')
@auth()
def logout():
    token = request.headers.get('Authorization','').removeprefix('Bearer ')
    db().execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
    db().execute('UPDATE users SET online=0 WHERE id=?',(g.user['id'],))
    db().commit()
    return jsonify(ok=True)

def busy(user_id, driver=False):
    field = 'driver_id' if driver else 'customer_id'
    return db().execute(f"SELECT id FROM trips WHERE {field}=? AND status IN ('searching','accepted','arrived','in_progress')",(user_id,)).fetchone()

def trip_for(trip_id):
    t = db().execute('SELECT * FROM trips WHERE id=?',(trip_id,)).fetchone()
    if not t: raise ApiError('الرحلة غير موجودة',404)
    if g.user['role'] != 'admin' and g.user['id'] not in (t['customer_id'],t['driver_id']): raise ApiError('لا يمكنك الوصول إلى هذه الرحلة',403)
    return t

def packed_trip(t):
    t = dict(t)
    owner = g.user['id'] == t['customer_id'] or g.user['role']=='admin'
    assigned = g.user['id'] == t['driver_id']
    if not owner: t.pop('code', None)
    for field,label in [('customer_id','customer'),('driver_id','driver')]:
        u = db().execute('SELECT * FROM users WHERE id=?',(t[field],)).fetchone() if t[field] else None
        if u:
            t[label] = {'id':u['id'],'name':u['name'],'vehicle':u['vehicle']}
            if t['driver_id'] and (owner or assigned): t[label]['phone'] = u['phone']
            rating = db().execute('SELECT ROUND(AVG(stars),1),COUNT(*) FROM ratings WHERE target_id=?',(u['id'],)).fetchone()
            t[label]['rating'], t[label]['reviews'] = rating[0],rating[1]
            if label=='driver' and (owner or assigned) and t['status'] in ACTIVE:
                t[label].update(lat=u['lat'],lng=u['lng'],location_at=u['location_at'])
    if owner:
        t['offers'] = [dict(o) for o in db().execute('''SELECT o.id,o.driver_id,o.price,u.name,u.vehicle,
          (SELECT ROUND(AVG(stars),1) FROM ratings WHERE target_id=u.id) rating
          FROM offers o JOIN users u ON u.id=o.driver_id WHERE trip_id=? ORDER BY o.price''',(t['id'],))]
    else:
        o = db().execute('SELECT price FROM offers WHERE trip_id=? AND driver_id=?',(t['id'],g.user['id'])).fetchone()
        t['my_offer'] = o[0] if o else None
    t['rated'] = bool(db().execute('SELECT 1 FROM ratings WHERE trip_id=? AND user_id=?',(t['id'],g.user['id'])).fetchone())
    return t

@app.get('/api/state')
@auth()
def state():
    u = g.user
    if u['role']=='admin':
        trips = db().execute('SELECT * FROM trips ORDER BY id DESC LIMIT 200').fetchall()
        return jsonify(user=public_user(u),trips=[packed_trip(t) for t in trips],
            users=[public_user(x) for x in db().execute('SELECT * FROM users ORDER BY id DESC LIMIT 500')],
            reports=[dict(x) for x in db().execute('SELECT * FROM reports ORDER BY id DESC LIMIT 200')])
    field = 'customer_id' if u['role']=='customer' else 'driver_id'
    trips = db().execute(f'SELECT * FROM trips WHERE {field}=? ORDER BY id DESC LIMIT 100',(u['id'],)).fetchall()
    available = []
    if u['role']=='driver' and u['online'] and u['approved'] and not busy(u['id'],True):
        available = db().execute("SELECT * FROM trips WHERE status='searching' ORDER BY id DESC LIMIT 50").fetchall()
    return jsonify(user=public_user(u), trips=[packed_trip(t) for t in trips], available=[packed_trip(t) for t in available])

@app.post('/api/profile')
@auth()
def profile():
    d=data()
    db().execute('UPDATE users SET name=? WHERE id=?',(text_value(d,'name',2,70),g.user['id']))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/online')
@auth('driver')
def online():
    if not g.user['approved']: raise ApiError('حسابك في انتظار اعتماد الإدارة',403)
    value = data().get('online')
    if not isinstance(value,bool): raise ApiError('حالة غير صحيحة')
    db().execute('UPDATE users SET online=? WHERE id=?',(int(value),g.user['id']))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/location')
@auth('driver')
def location():
    lat,lng = coordinates(data(),required=True)
    db().execute('UPDATE users SET lat=?,lng=?,location_at=? WHERE id=?',(lat,lng,time.time(),g.user['id']))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/trips')
@auth('customer')
def create_trip():
    d=data()
    pickup,dest = text_value(d,'pickup',3),text_value(d,'destination',3)
    price = price_value(d.get('price'))
    lat,lng = coordinates(d)
    dlat,dlng = coordinates(d,'dest_lat','dest_lng')
    note=text_value(d,'note',0,300)
    db().execute('BEGIN IMMEDIATE')
    if busy(g.user['id']): raise ApiError('عندك رحلة نشطة بالفعل',409)
    now = time.time()
    cur = db().execute('''INSERT INTO trips(customer_id,pickup,destination,lat,lng,dest_lat,dest_lng,price,code,note,created,updated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',(g.user['id'],pickup,dest,lat,lng,dlat,dlng,price,str(secrets.randbelow(9000)+1000),note,now,now))
    db().commit()
    return jsonify(id=cur.lastrowid)

@app.post('/api/trips/<int:tid>/offer')
@auth('driver')
def offer(tid):
    p=price_value(data().get('price'))
    db().execute('BEGIN IMMEDIATE')
    t=db().execute('SELECT * FROM trips WHERE id=?',(tid,)).fetchone()
    if not g.user['approved'] or not g.user['online']: raise ApiError('فعّل استقبال الطلبات بعد اعتماد حسابك',403)
    if not t or t['status']!='searching': raise ApiError('الطلب لم يعد متاحًا',409)
    if busy(g.user['id'],True): raise ApiError('أكمل رحلتك الحالية أولًا',409)
    db().execute('INSERT INTO offers(trip_id,driver_id,price,created) VALUES (?,?,?,?) ON CONFLICT(trip_id,driver_id) DO UPDATE SET price=excluded.price,created=excluded.created',(tid,g.user['id'],p,time.time()))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/trips/<int:tid>/accept')
@auth('customer')
def accept(tid):
    d=data()
    db().execute('BEGIN IMMEDIATE')
    t=trip_for(tid)
    if t['status']!='searching': raise ApiError('تم التعامل مع الطلب بالفعل',409)
    o=db().execute('SELECT o.*,u.online,u.approved FROM offers o JOIN users u ON u.id=o.driver_id WHERE o.id=? AND o.trip_id=?',(d.get('offer_id'),tid)).fetchone()
    if not o or not o['online'] or not o['approved'] or busy(o['driver_id'],True): raise ApiError('السائق غير متاح؛ اختار عرضًا آخر',409)
    db().execute("UPDATE trips SET driver_id=?,price=?,status='accepted',updated=? WHERE id=?",(o['driver_id'],o['price'],time.time(),tid))
    db().execute('DELETE FROM offers WHERE driver_id=? AND trip_id<>?',(o['driver_id'],tid))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/trips/<int:tid>/status')
@auth()
def trip_status(tid):
    d=data()
    db().execute('BEGIN IMMEDIATE')
    t=trip_for(tid)
    new=d.get('status')
    if new=='cancelled':
        if t['status'] not in ('searching','accepted','arrived'): raise ApiError('لا يمكن إلغاء الرحلة في هذه المرحلة',409)
        reason=text_value(d,'reason',3,200)
    else:
        if g.user['id']!=t['driver_id']: raise ApiError('الإجراء متاح لسائق الرحلة فقط',403)
        if {'accepted':'arrived','arrived':'in_progress','in_progress':'completed'}.get(t['status'])!=new: raise ApiError('انتقال حالة غير صحيح',409)
        if new=='in_progress' and str(d.get('code',''))!=t['code']: raise ApiError('كود بدء الرحلة غير صحيح')
        reason=''
    db().execute('UPDATE trips SET status=?,cancelled_reason=?,updated=? WHERE id=?',(new,reason,time.time(),tid))
    db().commit()
    return jsonify(ok=True)

@app.get('/api/trips/<int:tid>/messages')
@auth()
def messages(tid):
    trip_for(tid)
    return jsonify(messages=[dict(m) for m in db().execute('SELECT m.id,m.user_id,m.body,m.created,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE trip_id=? ORDER BY m.id LIMIT 300',(tid,))])

@app.post('/api/trips/<int:tid>/messages')
@auth('customer','driver')
def send_message(tid):
    t=trip_for(tid)
    if not t['driver_id'] or t['status'] not in ACTIVE: raise ApiError('الرسائل متاحة أثناء الرحلة بعد قبول السائق')
    body=text_value(data(),'body',1,1000)
    count=db().execute('SELECT COUNT(*) FROM messages WHERE trip_id=?',(tid,)).fetchone()[0]
    if count>=300: raise ApiError('وصلت للحد الأقصى لرسائل الرحلة')
    db().execute('INSERT INTO messages(trip_id,user_id,body,created) VALUES (?,?,?,?)',(tid,g.user['id'],body,time.time()))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/trips/<int:tid>/rating')
@auth('customer','driver')
def rating(tid):
    t=trip_for(tid)
    d=data()
    stars=d.get('stars')
    if type(stars) is not int or not 1<=stars<=5: raise ApiError('التقييم من 1 إلى 5')
    if t['status']!='completed': raise ApiError('التقييم بعد نهاية الرحلة')
    target=t['driver_id'] if g.user['id']==t['customer_id'] else t['customer_id']
    try: db().execute('INSERT INTO ratings VALUES (?,?,?,?,?)',(tid,g.user['id'],target,stars,text_value(d,'comment',0,300)))
    except sqlite3.IntegrityError: raise ApiError('تم تقييم الرحلة بالفعل',409)
    db().commit()
    return jsonify(ok=True)

@app.post('/api/reports')
@auth()
def report():
    d=data()
    if d.get('trip_id'): trip_for(d['trip_id'])
    db().execute('INSERT INTO reports(user_id,trip_id,body,created) VALUES (?,?,?,?)',(g.user['id'],d.get('trip_id'),text_value(d,'body',5,1000),time.time()))
    db().commit()
    return jsonify(ok=True)

@app.post('/api/admin/users/<int:uid>/approve')
@auth('admin')
def approve(uid):
    value=data().get('approved')
    if not isinstance(value,bool): raise ApiError('حالة غير صحيحة')
    db().execute("UPDATE users SET approved=?,online=CASE WHEN ?=0 THEN 0 ELSE online END WHERE id=? AND role='driver'",(int(value),int(value),uid))
    db().commit()
    return jsonify(ok=True)

@app.get('/api/health')
def health(): return jsonify(ok=True)

@app.get('/')
def index(): return send_from_directory(ROOT/'web','index.html')

@app.get('/<path:path>')
def static_file(path): return send_from_directory(ROOT/'web',path)

init_db()
DUMMY_PASSWORD=generate_password_hash(secrets.token_urlsafe(24))

if __name__=='__main__':
    import argparse, getpass
    parser=argparse.ArgumentParser()
    parser.add_argument('--create-admin',action='store_true')
    args=parser.parse_args()
    if args.create_admin:
        phone=input('Admin phone (+20...): ').strip()
        password=getpass.getpass('Password (at least 12 characters): ')
        if not re.fullmatch(r'\+?[0-9]{8,15}',phone) or len(password)<12: raise SystemExit('Invalid phone/password')
        with app.app_context():
            db().execute("INSERT INTO users(name,phone,password,role,approved,created) VALUES (?,?,?,'admin',1,?)",('الإدارة',phone,generate_password_hash(password),time.time()))
            db().commit()
        print('Admin created. Sign in through the customer tab.')
    else:
        app.run(host='127.0.0.1',port=int(os.environ.get('PORT',8080)),debug=False)
