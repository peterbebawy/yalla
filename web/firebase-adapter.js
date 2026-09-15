'use strict';
/* Firebase Realtime Database adapter for the existing Yalla Toktok UI.
 * It preserves the original api(path, body) contract so the visual layer does
 * not need to be rewritten. The legacy Flask API remains available as a
 * fallback when YALLA_CONFIG.backend is set to "server".
 */
(() => {
  const cfg = window.YALLA_FIREBASE_CONFIG || {};
  const configured = Boolean(cfg.apiKey && cfg.databaseURL && !String(cfg.apiKey).includes('PUT_YOUR_'));
  const ACTIVE = ['searching','accepted','arrived','in_progress'];
  let auth = null, db = null, ready = Promise.resolve(null);

  const now = () => Date.now() / 1000;
  const id = () => Date.now() * 100 + Math.floor(Math.random() * 100);
  const boolNum = v => v ? 1 : 0;
  const asObject = snap => snap && snap.exists() ? snap.val() : null;
  const cleanPhone = value => String(value || '').trim();
  const validPhone = value => /^\+?[0-9]{8,15}$/.test(cleanPhone(value));
  const phoneEmail = value => `p${cleanPhone(value).replace(/\D/g,'')}@auth.yallatoktok.invalid`;
  const roleLabel = role => role === 'driver' ? 'دريفر' : role === 'admin' ? 'الإدارة' : 'عميل';

  function assertReady() {
    if (!configured) throw new Error('Firebase غير مربوط بعد. افتح web/firebase-config.js وضع Firebase config الخاص بمشروعك.');
    if (!window.firebase) throw new Error('تعذر تحميل Firebase SDK. راجع اتصال الإنترنت.');
  }
  function message(error) {
    const code = error?.code || '';
    const map = {
      'auth/email-already-in-use':'رقم الهاتف مسجل بالفعل',
      'auth/invalid-credential':'رقم الهاتف أو كلمة المرور غير صحيحة',
      'auth/user-not-found':'رقم الهاتف أو كلمة المرور غير صحيحة',
      'auth/wrong-password':'رقم الهاتف أو كلمة المرور غير صحيحة',
      'auth/weak-password':'كلمة المرور ضعيفة؛ استخدم 8 أحرف على الأقل',
      'auth/too-many-requests':'محاولات كثيرة؛ جرّب مرة أخرى لاحقًا',
      'auth/network-request-failed':'تعذر الاتصال بـ Firebase. راجع الإنترنت.',
      'PERMISSION_DENIED':'لا تملك صلاحية هذا الإجراء'
    };
    return new Error(map[code] || map[error?.message] || error?.message || 'حصل خطأ، حاول تاني');
  }
  function publicUser(raw, uid) {
    if (!raw) return null;
    return {
      id: uid,
      name: raw.name || '', phone: raw.phone || '', role: raw.role || 'customer',
      vehicle: raw.vehicle || '', approved: boolNum(raw.approved), online: boolNum(raw.online)
    };
  }
  async function value(path) { return asObject(await db.ref(path).once('value')); }
  async function ownProfile() {
    const u = auth.currentUser;
    if (!u) throw Object.assign(new Error('سجل الدخول أولًا'), {code:'AUTH_REQUIRED'});
    const raw = await value(`users/${u.uid}`);
    if (!raw) throw new Error('بيانات الحساب غير موجودة في قاعدة البيانات');
    return publicUser(raw, u.uid);
  }
  async function isAdmin() { return (await ownProfile()).role === 'admin'; }
  async function ratingFor(uid) {
    if (!uid) return {rating:null,reviews:0};
    const rows = await value(`ratingStars/${uid}`) || {};
    const stars = Object.values(rows).map(x => Number(x?.stars)).filter(x => Number.isFinite(x));
    if (!stars.length) return {rating:null,reviews:0};
    return {rating: Math.round((stars.reduce((a,b)=>a+b,0)/stars.length)*10)/10, reviews:stars.length};
  }
  async function readTrip(tripId) {
    const raw = await value(`trips/${tripId}`);
    return raw ? {...raw, id:Number(tripId)} : null;
  }
  async function packTrip(tripId, viewer) {
    const t = await readTrip(tripId);
    if (!t) return null;
    const owner = viewer.role === 'admin' || t.customer_id === viewer.id;
    const assigned = t.driver_id === viewer.id;
    if (t.driver) {
      const r = await ratingFor(t.driver.id || t.driver_id);
      t.driver = {...t.driver, ...r};
    }
    if (t.customer) {
      const r = await ratingFor(t.customer.id || t.customer_id);
      t.customer = {...t.customer, ...r};
    }
    if (owner) {
      const offers = await value(`offers/${tripId}`) || {};
      t.offers = Object.values(offers).map(o => ({...o,id:Number(o.id)})).sort((a,b)=>Number(a.price)-Number(b.price));
      const secret = await value(`tripSecrets/${tripId}`);
      if (secret?.code) t.code = String(secret.code);
    } else {
      delete t.code;
      const mine = await value(`offers/${tripId}/${viewer.id}`).catch(()=>null);
      t.my_offer = mine?.price ?? null;
    }
    t.rated = Boolean(await value(`ratings/${tripId}/${viewer.id}`).catch(()=>null));
    if (!owner && !assigned && t.status !== 'searching') return null;
    return t;
  }
  async function idsAt(path) {
    const rows = await value(path) || {};
    return Object.keys(rows).filter(k => rows[k]);
  }
  async function loadTrips(ids, viewer) {
    const items = [];
    for (const tripId of ids) {
      try { const t = await packTrip(tripId, viewer); if (t) items.push(t); } catch (_) { /* stale index */ }
    }
    return items.sort((a,b)=>Number(b.id)-Number(a.id));
  }
  async function hasActive(items) { return items.some(t => ACTIVE.includes(t.status)); }

  async function register(body) {
    if (!validPhone(body.phone)) throw new Error('اكتب رقم الهاتف بالأرقام الإنجليزية مع كود الدولة');
    if (!['customer','driver'].includes(body.role)) throw new Error('اختار عميل أو دريفر');
    if (String(body.name||'').trim().length < 2) throw new Error('اكتب الاسم بالكامل');
    if (String(body.password||'').length < 8) throw new Error('كلمة المرور 8 أحرف على الأقل');
    if (body.role === 'driver' && String(body.vehicle||'').trim().length < 2) throw new Error('اكتب رقم التوكتوك');
    try {
      const cred = await auth.createUserWithEmailAndPassword(phoneEmail(body.phone), body.password);
      const profile = {
        name:String(body.name).trim(), phone:cleanPhone(body.phone), role:body.role,
        vehicle:body.role==='driver'?String(body.vehicle).trim():'',
        approved:body.role==='customer', online:false, lat:null, lng:null, location_at:null, created:now()
      };
      await db.ref(`users/${cred.user.uid}`).set(profile);
      return {token:'firebase', user:publicUser(profile,cred.user.uid)};
    } catch(e) { throw message(e); }
  }
  async function login(body) {
    if (!validPhone(body.phone)) throw new Error('اكتب رقم الهاتف بالأرقام الإنجليزية مع كود الدولة');
    try {
      const cred = await auth.signInWithEmailAndPassword(phoneEmail(body.phone), body.password);
      const raw = await value(`users/${cred.user.uid}`);
      if (!raw) { await auth.signOut(); throw new Error('بيانات الحساب غير موجودة'); }
      if (raw.role !== 'admin' && raw.role !== body.role) { await auth.signOut(); throw new Error(`اختار نوع الحساب الصحيح (${roleLabel(raw.role)})`); }
      return {token:'firebase', user:publicUser(raw,cred.user.uid)};
    } catch(e) { throw message(e); }
  }
  async function logout() {
    const u = auth.currentUser;
    if (u) {
      const raw = await value(`users/${u.uid}`).catch(()=>null);
      if (raw?.role === 'driver') await db.ref(`users/${u.uid}/online`).set(false).catch(()=>{});
    }
    await auth.signOut(); return {ok:true};
  }
  async function state() {
    const viewer = await ownProfile();
    if (viewer.role === 'admin') {
      const usersRaw = await value('users') || {}, tripsRaw = await value('trips') || {}, reportsRaw = await value('reports') || {};
      const users = Object.entries(usersRaw).map(([uid,u])=>publicUser(u,uid)).sort((a,b)=>String(b.id).localeCompare(String(a.id))).slice(0,500);
      const tripIds = Object.keys(tripsRaw).sort((a,b)=>Number(b)-Number(a)).slice(0,200);
      const trips = await loadTrips(tripIds,viewer);
      const reports = Object.values(reportsRaw).sort((a,b)=>Number(b.created)-Number(a.created)).slice(0,200);
      return {user:viewer,users,trips,reports};
    }
    const indexPath = viewer.role === 'customer' ? `userTrips/${viewer.id}` : `driverTrips/${viewer.id}`;
    const trips = await loadTrips(await idsAt(indexPath), viewer);
    let available = [];
    if (viewer.role === 'driver' && viewer.online && viewer.approved && !(await hasActive(trips))) {
      available = await loadTrips((await idsAt('availableTrips')).slice(-50), viewer);
      available = available.filter(t=>t.status==='searching').slice(0,50);
    }
    return {user:viewer,trips,available};
  }
  async function profile(body) {
    const viewer = await ownProfile();
    const name = String(body.name||'').trim();
    if (name.length < 2 || name.length > 70) throw new Error('راجع الاسم');
    await db.ref(`users/${viewer.id}/name`).set(name); return {ok:true};
  }
  async function online(body) {
    const viewer = await ownProfile();
    if (viewer.role !== 'driver') throw new Error('الإجراء متاح للدريفر فقط');
    if (!viewer.approved) throw new Error('حسابك في انتظار اعتماد الإدارة');
    if (typeof body.online !== 'boolean') throw new Error('حالة غير صحيحة');
    await db.ref(`users/${viewer.id}/online`).set(body.online); return {ok:true};
  }
  async function location(body) {
    const viewer = await ownProfile();
    if (viewer.role !== 'driver') throw new Error('الإجراء متاح للدريفر فقط');
    const lat=Number(body.lat),lng=Number(body.lng);
    if (!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180) throw new Error('إحداثيات الموقع غير صحيحة');
    await db.ref(`users/${viewer.id}`).update({lat,lng,location_at:now()}); return {ok:true};
  }
  async function createTrip(body) {
    const viewer = await ownProfile();
    if (viewer.role !== 'customer') throw new Error('الإجراء متاح للعميل فقط');
    const current = await loadTrips(await idsAt(`userTrips/${viewer.id}`), viewer);
    if (await hasActive(current)) throw new Error('عندك رحلة نشطة بالفعل');
    const pickup=String(body.pickup||'').trim(),destination=String(body.destination||'').trim(),note=String(body.note||'').trim();
    const price=Math.round(Number(body.price)*100)/100;
    if (pickup.length<3||destination.length<3) throw new Error('راجع مكان الركوب والوجهة');
    if (!Number.isFinite(price)||price<5||price>5000) throw new Error('السعر من 5 إلى 5000 جنيه');
    const tripId=id(), code=String(Math.floor(1000+Math.random()*9000)), created=now();
    const numOrNull=v=>v===''||v==null?null:Number(v);
    const trip={customer_id:viewer.id,customer:{id:viewer.id,name:viewer.name},driver_id:null,driver:null,
      pickup,destination,lat:numOrNull(body.lat),lng:numOrNull(body.lng),dest_lat:numOrNull(body.dest_lat),dest_lng:numOrNull(body.dest_lng),
      price,status:'searching',note:note.slice(0,300),created,updated:created,cancelled_reason:''};
    await db.ref(`trips/${tripId}`).set(trip);
    await db.ref(`tripSecrets/${tripId}`).set({code});
    await db.ref(`userTrips/${viewer.id}/${tripId}`).set(true);
    await db.ref(`availableTrips/${tripId}`).set(true);
    return {id:tripId};
  }
  async function offer(tripId, body) {
    const viewer=await ownProfile();
    if (viewer.role!=='driver'||!viewer.approved||!viewer.online) throw new Error('فعّل استقبال الطلبات بعد اعتماد حسابك');
    const mine=await loadTrips(await idsAt(`driverTrips/${viewer.id}`),viewer);
    if (await hasActive(mine)) throw new Error('أكمل رحلتك الحالية أولًا');
    const t=await readTrip(tripId); if(!t||t.status!=='searching')throw new Error('الطلب لم يعد متاحًا');
    const price=Math.round(Number(body.price)*100)/100;if(!Number.isFinite(price)||price<5||price>5000)throw new Error('السعر من 5 إلى 5000 جنيه');
    const r=await ratingFor(viewer.id);
    await db.ref(`offers/${tripId}/${viewer.id}`).set({id:id(),driver_id:viewer.id,price,name:viewer.name,vehicle:viewer.vehicle,rating:r.rating,created:now()});
    return {ok:true};
  }
  async function accept(tripId, body) {
    const viewer=await ownProfile(), t=await readTrip(tripId);
    if(!t||t.customer_id!==viewer.id||t.status!=='searching')throw new Error('تم التعامل مع الطلب بالفعل');
    const offers=await value(`offers/${tripId}`)||{};
    const o=Object.values(offers).find(x=>Number(x.id)===Number(body.offer_id));
    if(!o)throw new Error('العرض غير متاح');
    const driver=await value(`users/${o.driver_id}`).catch(()=>null);
    if(!driver||!driver.approved||!driver.online)throw new Error('السائق غير متاح؛ اختار عرضًا آخر');
    await db.ref(`trips/${tripId}`).update({driver_id:o.driver_id,driver:{id:o.driver_id,name:o.name,vehicle:o.vehicle},price:Number(o.price),status:'accepted',updated:now()});
    await db.ref(`driverTrips/${o.driver_id}/${tripId}`).set(true);
    await db.ref(`availableTrips/${tripId}`).remove();
    return {ok:true};
  }
  async function status(tripId, body) {
    const viewer=await ownProfile(), t=await readTrip(tripId); if(!t)throw new Error('الرحلة غير موجودة');
    const isParty=t.customer_id===viewer.id||t.driver_id===viewer.id||viewer.role==='admin'; if(!isParty)throw new Error('لا يمكنك الوصول إلى هذه الرحلة');
    const next=body.status;
    if(next==='cancelled'){
      if(!['searching','accepted','arrived'].includes(t.status))throw new Error('لا يمكن إلغاء الرحلة في هذه المرحلة');
      const reason=String(body.reason||'').trim();if(reason.length<3)throw new Error('اكتب سبب الإلغاء');
      await db.ref(`trips/${tripId}`).update({status:'cancelled',cancelled_reason:reason.slice(0,200),updated:now()});
      await db.ref(`availableTrips/${tripId}`).remove().catch(()=>{}); return {ok:true};
    }
    if(t.driver_id!==viewer.id)throw new Error('الإجراء متاح لسائق الرحلة فقط');
    const expected={accepted:'arrived',arrived:'in_progress',in_progress:'completed'}[t.status];if(expected!==next)throw new Error('انتقال حالة غير صحيح');
    const update={status:next,updated:now()};
    if(next==='in_progress') update.start_code_attempt=String(body.code||'');
    await db.ref(`trips/${tripId}`).update(update);
    return {ok:true};
  }
  async function messages(tripId, body) {
    const viewer=await ownProfile();
    if(body===undefined){
      const rows=await value(`messages/${tripId}`)||{};
      return {messages:Object.values(rows).sort((a,b)=>Number(a.created)-Number(b.created)).slice(0,300)};
    }
    const t=await readTrip(tripId); if(!t||!t.driver_id||!ACTIVE.includes(t.status))throw new Error('الرسائل متاحة أثناء الرحلة بعد قبول السائق');
    if(![t.customer_id,t.driver_id].includes(viewer.id))throw new Error('لا يمكنك الوصول إلى هذه الرحلة');
    const text=String(body.body||'').trim();if(!text||text.length>1000)throw new Error('راجع الرسالة');
    const mid=id(); await db.ref(`messages/${tripId}/${mid}`).set({id:mid,user_id:viewer.id,name:viewer.name,body:text,created:now()});return {ok:true};
  }
  async function rating(tripId, body) {
    const viewer=await ownProfile(),t=await readTrip(tripId);if(!t||t.status!=='completed')throw new Error('التقييم بعد نهاية الرحلة');
    if(![t.customer_id,t.driver_id].includes(viewer.id))throw new Error('لا يمكنك تقييم هذه الرحلة');
    if(await value(`ratings/${tripId}/${viewer.id}`))throw new Error('تم تقييم الرحلة بالفعل');
    const stars=Number(body.stars);if(!Number.isInteger(stars)||stars<1||stars>5)throw new Error('التقييم من 1 إلى 5');
    const target=t.customer_id===viewer.id?t.driver_id:t.customer_id,created=now(),comment=String(body.comment||'').slice(0,300);
    await db.ref(`ratings/${tripId}/${viewer.id}`).set({target_id:target,stars,comment,created});
    await db.ref(`ratingStars/${target}/${tripId}`).set({stars,rater_uid:viewer.id,created});return {ok:true};
  }
  async function report(body) {
    const viewer=await ownProfile(),text=String(body.body||'').trim();if(text.length<5||text.length>1000)throw new Error('راجع تفاصيل البلاغ');
    const rid=id();await db.ref(`reports/${rid}`).set({id:rid,user_id:viewer.id,trip_id:body.trip_id||null,body:text,created:now()});return {ok:true};
  }
  async function approve(uid, body) {
    const viewer=await ownProfile();if(viewer.role!=='admin')throw new Error('لا تملك صلاحية هذا الإجراء');
    const approved=Boolean(body.approved);await db.ref(`users/${uid}`).update({approved,online:approved?false:false});return {ok:true};
  }

  async function api(path, body) {
    assertReady(); await ready;
    try {
      if(path==='/register')return await register(body||{});
      if(path==='/login')return await login(body||{});
      if(path==='/logout')return await logout();
      if(path==='/state')return await state();
      if(path==='/profile')return await profile(body||{});
      if(path==='/online')return await online(body||{});
      if(path==='/location')return await location(body||{});
      if(path==='/trips'&&body!==undefined)return await createTrip(body||{});
      if(path==='/reports')return await report(body||{});
      let m=path.match(/^\/admin\/users\/([^/]+)\/approve$/);if(m)return await approve(m[1],body||{});
      m=path.match(/^\/trips\/(\d+)\/(offer|accept|status|messages|rating)$/);
      if(m){const tid=m[1],op=m[2];if(op==='offer')return await offer(tid,body||{});if(op==='accept')return await accept(tid,body||{});if(op==='status')return await status(tid,body||{});if(op==='messages')return await messages(tid,body);if(op==='rating')return await rating(tid,body||{});}
      throw new Error('الإجراء غير مدعوم في نسخة Firebase');
    } catch(e) { throw message(e); }
  }

  if (configured && window.firebase) {
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      auth=firebase.auth(); db=firebase.database();
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
      ready=new Promise(resolve=>{const stop=auth.onAuthStateChanged(user=>{stop();resolve(user);},()=>resolve(null));});
    } catch(e) { console.error('Firebase init failed',e); }
  }
  window.YALLA_FIREBASE = {
    configured,
    get ready(){return ready;},
    currentUser:()=>auth?.currentUser || null,
    api
  };
})();
