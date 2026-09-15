'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => Number(n || 0).toLocaleString('ar-EG', {maximumFractionDigits:2});
const date = n => new Date(n*1000).toLocaleString('ar-EG', {dateStyle:'medium',timeStyle:'short'});
const paths = {
 user:'M20 21v-2a7 7 0 0 0-14 0v2M9 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
 wheel:'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M3 10h18M12 10v11M8 10l4 5 4-5',
 pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M9 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
 arrow:'M20 12H4m6-6-6 6 6 6', clock:'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2',
 shield:'m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6l8-4m-4 10 3 3 5-6',
 target:'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 1v3M12 20v3M1 12h3M20 12h3',
 chat:'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4M8 10h8M8 14h5',
 phone:'m7 3 3 5-3 3c1 3 3 5 6 6l3-3 5 3c-1 5-4 6-8 4C7 18 3 13 2 7c0-3 2-4 5-4',
 wallet:'M3 5h17v15H3V5m0 0 14-3v3M15 10h7v6h-7v-6m3 3h1',
 home:'m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7',
 logout:'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5', check:'m5 12 4 4L20 5', star:'m12 2 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1 3-7',
 list:'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1'
};
const icon = n => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${paths[n] || paths.pin}"/></svg></span>`;
const brand = () => `<div class="brand"><img src="assets/logo.png" alt="لوجو توكتوك أصفر"><div class="wordmark">يلا توكتوك<small>مشوارك على مزاجك</small></div></div>`;
const labels = {searching:'بنستنى عروض الدريفرز',accepted:'الدريفر في الطريق',arrived:'الدريفر وصل',in_progress:'الرحلة بدأت',completed:'رحلة مكتملة',cancelled:'رحلة ملغية'};
let role='customer', authMode='login', tab='home', filter='all', state=null, snapshot='', token=sessionStorage.getItem('yalla-token') || '', demo=false, pollBusy=false, gpsWatch=null, gpsLast=0, chatTrip=null, stars=5;
let booking={pickup:'',destination:'',price:25,note:'',lat:'',lng:'',dest_lat:'',dest_lng:''};
let demoState=null, demoMessages={};
const active = t => ['searching','accepted','arrived','in_progress'].includes(t.status);
const tripById = id => [...(state?.trips||[]),...(state?.available||[])].find(t=>t.id===Number(id));
function toast(message){ $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000); }
async function api(path,body){
  if(demo) return demoApi(path,body);
  let response;
  try{response=await fetch((window.YALLA_CONFIG?.apiBase || '')+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});}
  catch(e){throw new Error('تعذر الاتصال بالسيرفر. راجع الاتصال وعنوان السيرفر في config.js.');}
  let result;
  try{result=await response.json();}catch(e){throw new Error('السيرفر غير مربوط بالواجهة. شغّل السيرفر أو استخدم المعاينة التجريبية.');}
  if(!response.ok){if(response.status===401 && token){token='';sessionStorage.removeItem('yalla-token');state=null;stopGps();renderLogin();}throw new Error(result.error || 'حصل خطأ، حاول تاني');}
  return result;
}
function renderLogin(){
  $('#app').innerHTML=`<main class="login-shell"><section class="login-panel"><header class="login-head">${brand()}<span class="badge yellow">أهلًا بيك</span></header><div class="login-content"><div class="login-emblem"><img src="assets/logo.png" alt="يلا توكتوك"></div><h2>يلا نبدأ المشوار</h2><p class="muted">عميل ولا دريفر؟ اختار حسابك وكمّل.</p><div class="roles" role="group" aria-label="نوع الحساب"><button class="role ${role==='customer'?'selected':''}" data-action="role" data-role="customer" aria-pressed="${role==='customer'}">${icon('user')}<b>عميل</b><small>اطلب توكتوك لمشوارك</small></button><button class="role ${role==='driver'?'selected':''}" data-action="role" data-role="driver" aria-pressed="${role==='driver'}">${icon('wheel')}<b>دريفر</b><small>استقبل طلبات وزوّد دخلك</small></button></div><div class="auth-tabs"><button data-action="auth-mode" data-mode="login" class="${authMode==='login'?'active':''}">تسجيل الدخول</button><button data-action="auth-mode" data-mode="register" class="${authMode==='register'?'active':''}">حساب جديد</button></div><form id="auth-form"><div class="form-error" id="auth-error" role="alert"></div>${authMode==='register'?'<div class="form-field"><label for="name">الاسم بالكامل</label><input id="name" name="name" autocomplete="name" minlength="2" maxlength="70" required placeholder="اسمك اللي هيظهر في الرحلة"></div>':''}<div class="form-field"><label for="phone">رقم الموبايل بكود الدولة</label><input id="phone" name="phone" type="tel" dir="ltr" autocomplete="tel" placeholder="+201012345678" pattern="[+]?[0-9]{8,15}" required></div><div class="form-field"><label for="password">كلمة المرور</label><input id="password" name="password" type="password" autocomplete="${authMode==='register'?'new-password':'current-password'}" minlength="${authMode==='register'?8:1}" maxlength="128" placeholder="${authMode==='register'?'8 أحرف على الأقل':'اكتب كلمة المرور'}" required></div>${authMode==='register'&&role==='driver'?'<div class="form-field"><label for="vehicle">رقم لوحة التوكتوك أو رقم التعريف</label><input id="vehicle" name="vehicle" required minlength="2" maxlength="40" placeholder="رقم التوكتوك"></div><p class="small muted" style="margin-bottom:14px">الإدارة هتراجع حسابك قبل تفعيل استقبال الرحلات.</p>':''}<button class="btn dark full" type="submit">${authMode==='login'?'دخول':'إنشاء الحساب'} كـ${role==='customer'?'عميل':'دريفر'} ${icon('arrow')}</button></form><button class="demo-link" data-action="demo">استكشف تجربة ${role==='customer'?'العميل':'الدريفر'} بدون حساب</button></div><footer class="login-bottom">اتفق على السعر قبل ما تتحرك. الدفع كاش في نهاية الرحلة.</footer></section><aside class="login-art"><div><div class="pill">لون واحد.. لمشاوير كتير</div><h1>يلا توكتوك</h1><p class="art-tagline">مشوار بسيط.<br>وبداية على مزاجك.</p></div><img class="main-logo" src="assets/logo.png" alt="توكتوك أصفر وأسود"><div class="art-footer"><div><b>سعرك باختيارك</b><span>قارن عروض الدريفرز</span></div><div><b>متابعة الرحلة</b><span>من القبول لحد الوصول</span></div><div><b>كاش وبساطة</b><span>ادفع بعد ما توصل</span></div></div></aside></main>`;
}
function navItems(){return state.user.role==='admin'?[['home','لوحة الإدارة','home'],['history','الرحلات','clock'],['profile','حسابي','user']]:[['home',state.user.role==='driver'?'الطلبات':'الرئيسية','home'],['history','الرحلات','clock'],['support','الدعم','phone'],['profile','حسابي','user']];}
function shell(content){
 const u=state.user, nav=navItems();
 $('#app').innerHTML=`<header class="topbar">${brand()}<nav class="top-links" aria-label="القائمة الرئيسية">${nav.map(([k,v])=>`<button data-action="tab" data-tab="${k}" class="${tab===k?'active':''}">${v}</button>`).join('')}</nav><button class="account-btn" data-action="tab" data-tab="profile"><span class="avatar">${esc(u.name[0])}</span><span class="account-name"><b>${esc(u.name)}</b><span class="small muted" style="display:block">${u.role==='driver'?'حساب دريفر':u.role==='admin'?'الإدارة':'حساب عميل'}</span></span></button></header>${demo?'<div class="demo-banner">معاينة تجريبية — الأشخاص والطلبات هنا أمثلة، ولا يتم حجز رحلات حقيقية. <button class="link" data-action="logout">الخروج</button></div>':''}<div id="connection"></div><main class="workspace">${content}<footer class="footer">يلا توكتوك · مشوارك على مزاجك</footer></main><nav class="mobile-nav" aria-label="التنقل">${nav.map(([k,v,i])=>`<button data-action="tab" data-tab="${k}" class="${tab===k?'active':''}">${icon(i)}${v}</button>`).join('')}</nav>`;
}
function route(t){return `<div class="trip-route"><div class="row"><span class="point-symbol"></span><div><small>من</small><strong>${esc(t.pickup)}</strong></div></div><div class="row"><span class="point-symbol end"></span><div><small>إلى</small><strong>${esc(t.destination)}</strong></div></div></div>`;}
function badge(t){return `<span class="badge ${t.status==='cancelled'?'red':t.status==='searching'?'yellow':''}">${labels[t.status]}</span>`;}
function mapView(t){
 const tracked=t?.driver?.lat!=null && t?.driver?.lng!=null;
 const lat=Number(tracked?t.driver.lat:t?.lat || booking.lat || 30.0444),lng=Number(tracked?t.driver.lng:t?.lng || booking.lng || 31.2357);
 const valid=tracked||t?.lat!=null&&t?.lat!==''||booking.lat!=='';
 const box=`${lng-.018},${lat-.012},${lng+.018},${lat+.012}`;
 return `<div class="map-column"><div class="map-card"><iframe title="خريطة الموقع من OpenStreetMap" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(box)}&layer=mapnik${valid?'&marker='+lat+','+lng:''}"></iframe><div class="map-label">${icon('pin')} ${tracked?'آخر موقع شاركه الدريفر':valid?'موقع الانطلاق':'الخريطة — حدد موقعك لعرض منطقتك'}</div><div class="map-bottom"><img src="assets/logo.png" alt="توكتوك"><div><h3>${t?labels[t.status]:'توكتوك لمشوارك الجاي'}</h3><p>${tracked?'آخر تحديث: '+date(t.driver.location_at):'الموقع بيتحدث لما الدريفر يفعّل مشاركته.'}</p></div></div></div><div class="map-note"><span>© مساهمو OpenStreetMap · الخريطة تحتاج إنترنت</span><a class="link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}">فتح الخريطة ↗</a></div>${t?.dest_lat!=null?`<a class="btn outline sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${t.dest_lat},${t.dest_lng}">${icon('pin')} الاتجاهات إلى الوجهة</a>`:''}</div>`;
}
function bookingForm(){return `<section class="card booking-card"><div class="section-title">${icon('pin')}<h3>اطلب توكتوكك</h3></div><form id="booking-form"><div class="point-input"><div class="row"><span class="point-symbol"></span><label for="pickup">منين؟</label></div><input id="pickup" name="pickup" required minlength="3" maxlength="180" placeholder="مكاني الحالي أو أقرب علامة" value="${esc(booking.pickup)}"><button type="button" class="location-button" data-action="locate">${icon('target')} تحديد المكان</button><span class="small muted" id="gps-label">${booking.lat!==''?'تم تحديد موقعك ✓':''}</span></div><div class="point-input"><div class="row"><span class="point-symbol end"></span><label for="destination">إلى أين؟</label></div><input id="destination" name="destination" minlength="3" maxlength="180" required placeholder="اختار وجهتك" value="${esc(booking.destination)}"></div><div class="fare-box"><div class="row between"><label for="price"><b>الأجرة اللي تناسبك</b></label><span class="small muted">جنيه مصري</span></div><div class="fare-control"><button type="button" class="stepper" data-action="fare" data-delta="5" aria-label="زيادة خمسة جنيهات">+</button><input id="price" name="price" type="number" min="5" max="5000" step="0.5" required value="${booking.price}"><button type="button" class="stepper" data-action="fare" data-delta="-5" aria-label="تقليل خمسة جنيهات">−</button></div><p class="small muted">ده عرضك للدريفر، والسعر النهائي باختيارك.</p></div><div class="form-field"><label for="note">ملاحظة للدريفر <span class="muted">(اختياري)</span></label><input id="note" name="note" maxlength="300" placeholder="مثال: مستني قدام الصيدلية" value="${esc(booking.note)}"></div><details><summary>إحداثيات المكان والوجهة (اختياري)</summary><p class="small muted">أدخل الإحداثيات لو محتاج علامة دقيقة على الخريطة.</p><div class="coordinates">${[['lat','خط عرض الركوب'],['lng','خط طول الركوب'],['dest_lat','خط عرض الوجهة'],['dest_lng','خط طول الوجهة']].map(([n,l])=>`<label class="small">${l}<input name="${n}" type="number" step="any" min="${n.includes('lat')?-90:-180}" max="${n.includes('lat')?90:180}" value="${booking[n]}"></label>`).join('')}</div></details><button type="submit" class="btn full mt request-ride"><img src="assets/logo.png" alt=""> اطلب توكتوكك</button><p class="small muted" style="text-align:center;margin-top:12px">الدفع كاش · مفيش خصم عند إرسال الطلب</p></form><div class="safety-note">${icon('shield')}<span>راجع بيانات الدريفر، وشاركه كود البداية بعد ما تتأكد من التوكتوك.</span></div></section>`;}
function currentCard(t){
 const customer=state.user.role==='customer';
 const person=customer?t.driver:t.customer;
 const stage=['searching','accepted','arrived','in_progress','completed'].indexOf(t.status);
 return `<section class="card"><div class="row between"><h3>مشوار #${t.id}</h3>${badge(t)}</div><div class="progress">${[0,1,2,3].map(i=>`<span class="${i<=stage?'done':''}"></span>`).join('')}</div>${route(t)}<div class="row between"><span class="muted">${t.status==='searching'?'السعر المقترح':'السعر المتفق عليه'}</span><strong style="font-size:1.6rem">${money(t.price)} <small>ج.م</small></strong></div>${t.note?`<p class="small muted mt">ملاحظة: ${esc(t.note)}</p>`:''}${t.status==='searching'?`<div class="mt"><h3>عروض الدريفرز <span class="badge yellow">${t.offers?.length || 0}</span></h3>${(t.offers||[]).map(o=>`<article class="offer"><div class="row between"><div class="row"><span class="driver-avatar">${esc(o.name[0])}</span><div><b>${esc(o.name)}</b><p class="small muted">${o.rating?'★ '+o.rating:'بدون تقييم بعد'} · ${esc(o.vehicle)}</p></div></div><span class="price">${money(o.price)}</span></div><button class="btn full sm" data-action="accept" data-id="${t.id}" data-offer="${o.id}">اختار الدريفر — ${money(o.price)} ج.م</button></article>`).join('')||'<div class="empty">'+icon('clock')+'<h3>مستنيين أول عرض</h3><p>العروض هتظهر هنا تلقائيًا لما دريفر يرد.</p></div>'}</div>`:''}${person?`<div class="driver-info"><h3 class="driver-title">${customer?'تفاصيل السائق':'تفاصيل العميل'}</h3><div class="row between"><div class="row"><span class="driver-avatar">${esc(person.name[0])}</span><div><b>${esc(person.name)}</b><p class="small muted">${esc(person.vehicle||'العميل')} ${person.rating?' · ★ '+person.rating:''}</p></div></div>${person.phone?`<a class="btn outline sm" href="tel:${esc(person.phone)}" aria-label="اتصال">${icon('phone')}</a>`:''}</div></div>`:''}${customer && ['accepted','arrived'].includes(t.status)?`<div class="pin"><span class="small">كود بدء الرحلة — شاركه بعد الركوب</span><strong class="mono">${esc(t.code)}</strong></div>`:''}${!customer?`<div class="stack mt">${t.status==='accepted'?`<button class="btn green full" data-action="status" data-id="${t.id}" data-status="arrived">وصلت لمكان العميل</button>`:t.status==='arrived'?`<button class="btn green full" data-action="start" data-id="${t.id}">ابدأ الرحلة بكود العميل</button>`:t.status==='in_progress'?`<button class="btn green full" data-action="complete" data-id="${t.id}">إنهاء الرحلة والتحصيل كاش</button>`:''}<button class="btn outline full" data-action="share-gps">${icon('target')} ${gpsWatch!==null?'مشاركة موقعي مفعّلة':'فعّل مشاركة موقعي'}</button></div>`:''}${t.driver_id?`<div class="row wrap mt"><button class="btn outline sm" data-action="chat" data-id="${t.id}">${icon('chat')} الرسائل</button><button class="btn outline sm" data-action="share-trip" data-id="${t.id}">مشاركة التفاصيل</button><button class="btn danger sm" data-action="report" data-id="${t.id}">مساعدة</button></div>`:''}${['searching','accepted','arrived'].includes(t.status)?`<button class="link mt" style="color:var(--red)" data-action="cancel" data-id="${t.id}">إلغاء المشوار</button>`:''}${demo&&customer&&t.driver_id?`<button class="demo-link" data-action="demo-progress" data-id="${t.id}">محاكاة ${t.status==='accepted'?'وصول الدريفر':t.status==='arrived'?'بدء الرحلة':'انتهاء الرحلة'}</button>`:''}</section>`;
}
function historyCard(t){return `<article class="card trip-card"><div class="row between"><span class="small muted">#${t.id} · ${date(t.created)}</span>${badge(t)}</div>${route(t)}<div class="row between"><strong class="amount">${money(t.price)} <small class="small">ج.م</small></strong><span class="small muted">دفع كاش</span></div>${t.cancelled_reason?`<p class="small muted mt">سبب الإلغاء: ${esc(t.cancelled_reason)}</p>`:''}<div class="row wrap mt">${t.status==='completed'&&!t.rated&&state.user.role!=='admin'?`<button class="btn sm" data-action="rate" data-id="${t.id}">${icon('star')} قيّم الرحلة</button>`:''}${t.rated?'<span class="badge">تم التقييم ✓</span>':''}${active(t)?'<button class="btn sm" data-action="tab" data-tab="home">متابعة المشوار</button>':''}${state.user.role!=='admin'?`<button class="btn outline sm" data-action="report" data-id="${t.id}">إبلاغ عن مشكلة</button>`:''}</div></article>`;}
function render(){
 if(!state)return renderLogin();
 const u=state.user, current=state.trips.find(active);
 let content='';
 if(tab==='support'){
 content=`<div class="profile-layout"><div class="page-heading"><div><h2>نساعدك إزاي؟</h2><p>ابعت استفسارك أو بلّغ عن مشكلة في مشوارك.</p></div></div><section class="card support-card"><span class="support-symbol">${icon('phone')}</span><h3>تواصل مع إدارة يلا توكتوك</h3><p class="muted">رسالتك هتظهر في لوحة الإدارة للمراجعة.</p><button class="btn full mt" data-action="report">إرسال استفسار أو بلاغ</button><p class="small muted mt">في حالة خطر فوري، تواصل مع خدمات الطوارئ المحلية. النموذج ده مش خدمة طوارئ أو دعم فوري.</p></section><div class="support-tips"><div>${icon('shield')}<span>راجع اسم ورقم التوكتوك قبل الركوب.</span></div><div>${icon('chat')}<span>نسّق مكان الركوب من رسائل الرحلة.</span></div><div>${icon('user')}<span>شارك تفاصيل الرحلة مع شخص تثق فيه.</span></div></div></div>`;
 }else if(tab==='profile'){
 content=`<div class="profile-layout"><div class="page-heading"><div><h2>حسابي</h2><p>بياناتك ومساعدة في مشاويرك</p></div></div><section class="card stack"><div class="row"><span class="avatar">${esc(u.name[0])}</span><div><h3>${esc(u.name)}</h3><p class="muted mono" dir="ltr">${esc(u.phone)}</p></div></div><form id="profile-form"><div class="form-field"><label for="profile-name">الاسم</label><input id="profile-name" name="name" value="${esc(u.name)}" minlength="2" maxlength="70" required></div><button class="btn" type="submit">حفظ التعديلات</button></form>${u.role==='driver'?`<p class="small">رقم التوكتوك: <b>${esc(u.vehicle)}</b></p><span class="badge ${u.approved?'':'yellow'}">${u.approved?'حساب معتمد':'في انتظار الاعتماد'}</span>`:''}<button class="btn outline" data-action="report">إرسال استفسار أو بلاغ للإدارة</button><button class="btn outline" data-action="privacy">الخصوصية وطريقة الاستخدام</button><button class="btn danger" data-action="logout">${icon('logout')} تسجيل الخروج</button></section></div>`;
 }else if(tab==='history'){
 const done=state.trips.filter(t=>t.status==='completed');
 content=`<div class="page-heading"><div><h2>رحلاتي</h2><p>تفاصيل مشاويرك وتقييماتك في مكان واحد</p></div></div><div class="stats"><div class="stat"><span>رحلات مكتملة</span><strong>${money(done.length)}</strong></div><div class="stat"><span>${u.role==='driver'?'إجمالي تحصيل كاش':'إجمالي قيمة الرحلات'}</span><strong>${money(done.reduce((s,t)=>s+t.price,0))} <small class="small">ج.م</small></strong></div><div class="stat"><span>رحلات ملغية</span><strong>${money(state.trips.filter(t=>t.status==='cancelled').length)}</strong></div></div><div class="history-filter">${[['all','الكل'],['completed','المكتملة'],['cancelled','الملغية']].map(([k,v])=>`<button data-action="filter" data-filter="${k}" class="${filter===k?'active':''}">${v}</button>`).join('')}</div><div class="list-grid">${state.trips.filter(t=>filter==='all'||t.status===filter).map(historyCard).join('')||'<div class="card empty">'+icon('clock')+'<h3>مفيش رحلات هنا لسه</h3><p>رحلاتك هتظهر بعد أول طلب.</p></div>'}</div><p class="small muted mt">الإحصائيات للرحلات المحمّلة فقط (آخر 100 رحلة للحساب).</p>`;
 }else if(u.role==='admin'){
 content=`<div class="page-heading"><div><h2>لوحة إدارة يلا توكتوك</h2><p>اعتماد السائقين ومراجعة النشاط والبلاغات</p></div></div><div class="stats"><div class="stat"><span>الحسابات المحمّلة</span><strong>${state.users.length}</strong></div><div class="stat"><span>رحلات نشطة</span><strong>${state.trips.filter(active).length}</strong></div><div class="stat"><span>البلاغات المحمّلة</span><strong>${state.reports.length}</strong></div></div><section class="card"><h3>السائقون</h3><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>التوكتوك</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${state.users.filter(x=>x.role==='driver').map(x=>`<tr><td>${esc(x.name)}</td><td dir="ltr">${esc(x.phone)}</td><td>${esc(x.vehicle)}</td><td>${x.approved?'معتمد':'بانتظار المراجعة'}</td><td><button class="btn sm ${x.approved?'danger':''}" data-action="approve" data-id="${x.id}" data-approved="${!x.approved}">${x.approved?'إيقاف الاستقبال':'اعتماد السائق'}</button></td></tr>`).join('')||'<tr><td colspan="5">لم يسجل سائقون بعد.</td></tr>'}</tbody></table></div></section><section class="card mt"><h3>البلاغات والاستفسارات</h3>${state.reports.map(r=>`<div class="offer"><div class="small muted">حساب #${r.user_id} · ${r.trip_id?'رحلة #'+r.trip_id:'استفسار عام'} · ${date(r.created)}</div><p>${esc(r.body)}</p></div>`).join('')||'<p class="muted mt">لا توجد بلاغات.</p>'}</section><p class="small muted mt">تعرض اللوحة آخر 500 حساب و200 رحلة و200 بلاغ.</p>`;
 }else if(u.role==='customer'){
 content=`<div class="page-heading"><div><h2>أهلًا ${esc(u.name.split(' ')[0])}، ${current?'نتابع مشوارك؟':'نروح فين؟'}</h2><p>${current?'تابع العرض وحالة المشوار من هنا.':'مشوارك بالسعر اللي تتفق عليه مع الدريفر.'}</p></div><span class="badge">${icon('wallet')} الدفع كاش</span></div><div class="ride-grid">${current?currentCard(current):bookingForm()}${mapView(current)}</div>`;
 }else{
 content=`<div class="page-heading"><div><h2>يومك حلو يا ${esc(u.name.split(' ')[0])}</h2><p>اختار طلب مناسب، وقدّم سعرك للعميل.</p></div><span class="badge">${esc(u.vehicle)}</span></div>${!u.approved?'<div class="notice">حسابك في انتظار الاعتماد. تواصل مع إدارة المنصة لمراجعة بياناتك وتفعيل استقبال الطلبات.</div>':''}<div class="driver-state row between"><div><h3>${u.online?'أنت متاح لاستقبال الطلبات':'أنت غير متاح حاليًا'}</h3><p>${u.online?'الطلبات الجديدة بتتحدث كل 3 ثوانٍ.':'فعّل الاستقبال لما تكون جاهز للشغل.'}</p></div><button class="switch ${u.online?'on':''}" role="switch" aria-checked="${!!u.online}" aria-label="استقبال طلبات الرحلات" data-action="online" ${!u.approved?'disabled':''}></button></div>${current?`<div class="ride-grid">${currentCard(current)}${mapView(current)}</div>`:`<div class="list-grid">${(state.available||[]).map(t=>`<article class="card trip-card"><div class="row between"><b>طلب مشوار #${t.id}</b><span class="badge yellow">جديد</span></div>${route(t)}${t.note?`<p class="small muted">${esc(t.note)}</p>`:''}<div class="row between mt"><span class="muted">عرض العميل</span><strong class="amount">${money(t.price)} <small class="small">ج.م</small></strong></div><p class="small muted">${t.my_offer?'عرضك الحالي: '+money(t.my_offer)+' ج.م':'قدّم عرضك، والعميل هيختار الدريفر.'}</p><button class="btn full mt" data-action="offer" data-id="${t.id}">${t.my_offer?'تعديل عرض السعر':'قدّم عرض السعر'}</button>${demo&&t.my_offer?`<button class="demo-link" data-action="demo-accept" data-id="${t.id}">محاكاة قبول العميل للعرض</button>`:''}</article>`).join('')||`<div class="card empty">${icon('wheel')}<h3>${u.online?'مفيش طلبات متاحة دلوقتي':'جاهز لمشوار جديد؟'}</h3><p>${u.online?'خليك متاح، الطلبات هتظهر تلقائيًا.':'فعّل استقبال الطلبات علشان تشوف الرحلات.'}</p></div>`}</div>`}`;
 }
 shell(content);
}
async function refresh(force=false){
 if(pollBusy || (!token&&!demo))return;
 pollBusy=true;
 try{
  const next=await api('/state');
  const nextSnapshot=JSON.stringify(next);
  state=next;
  if(gpsWatch!==null && !state.trips.some(active))stopGps();
  const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if(force||nextSnapshot!==snapshot&&!editing){snapshot=nextSnapshot;render();}
  if($('#connection'))$('#connection').textContent='';
  if(chatTrip && $('#chat-messages'))await loadChat();
 }catch(e){if($('#connection')){$('#connection').className='connection';$('#connection').textContent=e.message;}else if(force)toast(e.message);}
 finally{pollBusy=false;}
}
function modal(title,body){$('#dialog-content').innerHTML=`<div class="dialog-head"><h3>${title}</h3><button class="close" data-action="close" aria-label="إغلاق">×</button></div>${body}`;if(!$('#dialog').open)$('#dialog').showModal();}
function closeModal(){chatTrip=null;$('#dialog').close();}
function saveBooking(){const f=$('#booking-form');if(f)booking={...booking,...Object.fromEntries(new FormData(f))};}
function stopGps(){if(gpsWatch!==null)navigator.geolocation?.clearWatch(gpsWatch);gpsWatch=null;gpsLast=0;}
async function loadChat(){const r=await api('/trips/'+chatTrip+'/messages');const node=$('#chat-messages');if(node){const html=r.messages.map(m=>`<div class="message ${m.user_id===state.user.id?'mine':''}"><small>${esc(m.name)}</small>${esc(m.body)}<small>${new Date(m.created*1000).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</small></div>`).join('')||'<p class="muted small">ابدأ برسالة لتنسيق مكان الركوب.</p>';if(node.innerHTML!==html){node.innerHTML=html;node.scrollTop=node.scrollHeight;}}}
async function action(button){
 const a=button.dataset.action, id=Number(button.dataset.id), t=tripById(id);
 if(a==='role'){role=button.dataset.role;renderLogin();}
 if(a==='auth-mode'){authMode=button.dataset.mode;renderLogin();}
 if(a==='demo'){startDemo();render();}
 if(a==='tab'){saveBooking();tab=button.dataset.tab;render();}
 if(a==='filter'){filter=button.dataset.filter;render();}
 if(a==='close')closeModal();
 if(a==='logout'){if(!demo)await api('/logout',{});demo=false;token='';state=null;sessionStorage.removeItem('yalla-token');stopGps();closeModal();renderLogin();}
 if(a==='fare'){saveBooking();booking.price=Math.max(5,Math.min(5000,Number(booking.price)+Number(button.dataset.delta)));$('#price').value=booking.price;}
 if(a==='locate'){
  saveBooking();if(!navigator.geolocation)throw new Error('المتصفح لا يدعم تحديد الموقع');
  toast('جاري تحديد موقعك…');
  navigator.geolocation.getCurrentPosition(p=>{booking.lat=p.coords.latitude;booking.lng=p.coords.longitude;render();toast('تم تحديد الموقع؛ اكتب وصف مكان الركوب للدريفر.');},()=>toast('تعذر تحديد الموقع. اسمح بالموقع واستخدم HTTPS، أو أدخل الإحداثيات يدويًا.'),{enableHighAccuracy:true,timeout:15000});
 }
 if(a==='online'){await api('/online',{online:!state.user.online});await refresh(true);}
 if(a==='offer')modal('قدّم سعرك للعميل',`${route(t)}<form id="offer-form" data-id="${id}"><div class="form-field"><label for="offer-price">السعر بالجنيه</label><input id="offer-price" name="price" type="number" min="5" max="5000" step="0.5" value="${t.my_offer||t.price}" required></div><button class="btn full" type="submit">إرسال العرض</button></form>`);
 if(a==='accept'){
  const offer=t.offers.find(o=>o.id===Number(button.dataset.offer));
  modal('تأكيد اختيار الدريفر',`<p>هتأكد مشوارك مع <b>${esc(offer.name)}</b> بسعر <b>${money(offer.price)} جنيه</b>، والدفع كاش عند الوصول.</p><button class="btn full mt" data-action="confirm-accept" data-id="${id}" data-offer="${offer.id}">تأكيد المشوار</button>`);
 }
 if(a==='confirm-accept'){await api('/trips/'+id+'/accept',{offer_id:Number(button.dataset.offer)});closeModal();await refresh(true);}
 if(a==='cancel')modal('إلغاء المشوار',`<form id="cancel-form" data-id="${id}"><div class="form-field"><label for="reason">سبب الإلغاء</label><select name="reason" id="reason"><option>تغيرت خطتي</option><option>الانتظار طويل</option><option>السعر غير مناسب</option><option>تعذر الوصول لمكان الركوب</option></select></div><button type="submit" class="btn danger full">تأكيد إلغاء المشوار</button></form>`);
 if(a==='status'){await api('/trips/'+id+'/status',{status:button.dataset.status});await refresh(true);}
 if(a==='start')modal('كود بدء الرحلة',`<p class="small muted">اطلب الكود من العميل بعد الركوب.</p><form id="start-form" data-id="${id}"><div class="form-field mt"><label for="trip-code">كود من 4 أرقام</label><input id="trip-code" name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></div>${demo?'<p class="small muted">كود التجربة: 1234</p>':''}<button class="btn full" type="submit">بدء الرحلة</button></form>`);
 if(a==='complete')modal('وصلت بالسلامة',`<p>المبلغ المطلوب من العميل <b>${money(t.price)} جنيه كاش</b>. التأكيد يسجل انتهاء الرحلة، ولا ينفذ عملية دفع إلكتروني.</p><button class="btn green full mt" data-action="status-complete" data-id="${id}">تأكيد انتهاء الرحلة</button>`);
 if(a==='status-complete'){await api('/trips/'+id+'/status',{status:'completed'});closeModal();stopGps();tab='history';await refresh(true);}
 if(a==='share-gps'){
  if(gpsWatch!==null){stopGps();toast('تم إيقاف مشاركة الموقع');render();return;}
  if(demo){toast('مشاركة الموقع الحقيقية متاحة بعد تسجيل الدخول على السيرفر.');return;}
  if(!navigator.geolocation)throw new Error('المتصفح لا يدعم تحديد الموقع');
  gpsWatch=navigator.geolocation.watchPosition(async p=>{if(Date.now()-gpsLast<5000)return;gpsLast=Date.now();try{await api('/location',{lat:p.coords.latitude,lng:p.coords.longitude});}catch(e){toast(e.message);}},()=>{stopGps();toast('اسمح للموقع واستخدم اتصال HTTPS لتشغيل مشاركة الموقع.');render();},{enableHighAccuracy:true,timeout:20000,maximumAge:5000});render();toast('مشاركة الموقع تعمل أثناء فتح الصفحة. اضغط مرة أخرى لإيقافها.');
 }
 if(a==='chat'){chatTrip=id;modal('رسائل المشوار',`<div class="messages" id="chat-messages" aria-live="polite"></div><form class="chat-form" id="chat-form"><input name="body" aria-label="الرسالة" placeholder="اكتب رسالتك…" maxlength="1000" required autocomplete="off"><button class="btn" type="submit">إرسال</button></form>`);await loadChat();}
 if(a==='share-trip'){
  const description=`مشواري على يلا توكتوك #${id}\nمن: ${t.pickup}\nإلى: ${t.destination}\nالدريفر: ${t.driver?.name||'لم يتم الاختيار'}\nالتوكتوك: ${t.driver?.vehicle||'—'}\nالسعر: ${t.price} جنيه`;
  if(navigator.share){try{await navigator.share({title:'تفاصيل مشواري',text:description});}catch(e){if(e.name!=='AbortError')throw e;}}
  else modal('مشاركة تفاصيل المشوار',`<p class="small muted">انسخ التفاصيل وابعثها لشخص تثق فيه.</p><textarea rows="8" readonly>${esc(description)}</textarea>`);
 }
 if(a==='report')modal('إرسال بلاغ للإدارة',`<p class="small muted">البلاغ للمراجعة داخل المنصة، وليس خدمة طوارئ.</p><form id="report-form" data-id="${id||''}"><div class="form-field mt"><label for="report-body">تفاصيل المشكلة</label><textarea id="report-body" name="body" minlength="5" maxlength="1000" rows="4" required></textarea></div><button class="btn full" type="submit">إرسال البلاغ</button></form>`);
 if(a==='rate'){stars=5;modal('كانت الرحلة عاملة إيه؟',`<form id="rating-form" data-id="${id}"><div class="rating-select">${[1,2,3,4,5].map(n=>`<button type="button" class="chosen" aria-label="${n} من 5" data-action="star" data-stars="${n}">★</button>`).join('')}</div><div class="form-field"><label for="rating-comment">تعليق (اختياري)</label><textarea id="rating-comment" name="comment" maxlength="300" rows="3"></textarea></div><button class="btn full" type="submit">حفظ التقييم</button></form>`);}
 if(a==='star'){stars=Number(button.dataset.stars);document.querySelectorAll('[data-action="star"]').forEach(b=>b.classList.toggle('chosen',Number(b.dataset.stars)<=stars));}
 if(a==='approve'){await api('/admin/users/'+id+'/approve',{approved:button.dataset.approved==='true'});await refresh(true);}
 if(a==='privacy')modal('الخصوصية وطريقة الاستخدام','<div class="stack"><p>اسمك ومكان الركوب والوجهة متاحين للسائقين المعتمدين أثناء البحث. رقم هاتفك يظهر لطرف الرحلة بعد القبول، والإدارة تقدر تراجع الرحلات والبلاغات.</p><p>موقع الدريفر بيظهر لطرف الرحلة أثناء المشوار عند تفعيل مشاركته. إغلاق الصفحة أو إيقاف الإذن يوقف التحديث.</p><p>المشوار بسعر متفق عليه والدفع كاش. الخرائط من OpenStreetMap والخط من Google Fonts؛ تحميلهم يتصل بمقدمي الخدمات.</p><p>للتواصل بخصوص تعديل أو حذف بياناتك، ابعت استفسار للإدارة من صفحة حسابي. لازم مشغّل المنصة يضيف بيانات التواصل وسياسة الاحتفاظ بالبيانات قبل الإطلاق العام.</p></div>');
 if(a==='demo-accept'){const trip=demoState.available.find(x=>x.id===id);trip.price=trip.my_offer;trip.driver_id=2;trip.driver={id:2,name:demoState.user.name,vehicle:demoState.user.vehicle};trip.code='1234';trip.status='accepted';demoState.trips.unshift(trip);demoState.available=demoState.available.filter(x=>x.id!==id);await refresh(true);}
 if(a==='demo-progress'){t.status={accepted:'arrived',arrived:'in_progress',in_progress:'completed'}[t.status];const dt=demoState.trips.find(x=>x.id===id);dt.status=t.status;if(t.status==='completed')tab='history';await refresh(true);}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;try{await action(b);}catch(error){toast(error.message);}});
document.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target, fields=Object.fromEntries(new FormData(f)), b=f.querySelector('[type="submit"]');if(b)b.disabled=true;
 try{
  if(f.id==='auth-form'){const r=await api('/'+authMode,{...fields,role});token=r.token;sessionStorage.setItem('yalla-token',token);tab='home';await refresh(true);}
  if(f.id==='booking-form'){booking={...booking,...fields};await api('/trips',{...booking,price:Number(booking.price)});booking={pickup:'',destination:'',price:25,note:'',lat:'',lng:'',dest_lat:'',dest_lng:''};toast('تم إرسال الطلب، تابع عروض الدريفرز');await refresh(true);}
  if(f.id==='offer-form'){await api('/trips/'+f.dataset.id+'/offer',{price:Number(fields.price)});closeModal();toast('اترسل عرضك للعميل');await refresh(true);}
  if(f.id==='cancel-form'){await api('/trips/'+f.dataset.id+'/status',{status:'cancelled',reason:fields.reason});closeModal();stopGps();await refresh(true);}
  if(f.id==='start-form'){await api('/trips/'+f.dataset.id+'/status',{status:'in_progress',code:fields.code});closeModal();await refresh(true);}
  if(f.id==='chat-form'){await api('/trips/'+chatTrip+'/messages',fields);f.reset();await loadChat();}
  if(f.id==='profile-form'){await api('/profile',fields);toast('تم حفظ الاسم');await refresh(true);}
  if(f.id==='report-form'){await api('/reports',{...fields,trip_id:f.dataset.id?Number(f.dataset.id):null});closeModal();toast(demo?'تم تسجيل بلاغ تجريبي فقط':'تم إرسال البلاغ للإدارة');}
  if(f.id==='rating-form'){await api('/trips/'+f.dataset.id+'/rating',{...fields,stars});closeModal();toast('شكرًا على تقييمك');await refresh(true);}
 }catch(error){if(f.id==='auth-form'&&$('#auth-error'))$('#auth-error').textContent=error.message;else toast(error.message);}
 finally{if(b)b.disabled=false;}
});
$('#dialog').addEventListener('close',()=>{chatTrip=null;});
function startDemo(){
 demo=true;token='';tab='home';snapshot='';
 demoState={user:{id:role==='customer'?1:2,name:role==='customer'?'عميل تجريبي':'دريفر تجريبي',phone:'حساب معاينة',role,vehicle:'تجربة ١٢٣',approved:1,online:0},trips:[],available:[]};
 demoMessages={};state=structuredClone(demoState);
}
function demoTrip(){return {id:101,customer_id:1,driver_id:null,pickup:'ميدان المحطة — أمام الكشك',destination:'شارع السوق — أول الشارع',lat:30.0444,lng:31.2357,dest_lat:null,dest_lng:null,price:30,status:'searching',code:'1234',note:'طلب للتجربة فقط',created:Date.now()/1000,updated:Date.now()/1000,customer:{id:1,name:'عميل تجريبي'},rated:false,offers:[]};}
async function demoApi(path,body){
 if(path==='/state')return structuredClone(demoState);
 if(path==='/online'){demoState.user.online=Number(body.online);demoState.available=body.online&&!demoState.trips.some(active)?[demoTrip()]:[];return {ok:true};}
 if(path==='/profile'){demoState.user.name=body.name;return {ok:true};}
 if(path==='/reports')return {ok:true};
 if(path==='/trips'){
  if(demoState.trips.some(active))throw new Error('عندك رحلة نشطة بالفعل');
  const t={...demoTrip(),...body,id:Math.floor(Date.now()/1000),lat:body.lat===''?null:Number(body.lat),lng:body.lng===''?null:Number(body.lng),dest_lat:body.dest_lat===''?null:Number(body.dest_lat),dest_lng:body.dest_lng===''?null:Number(body.dest_lng)};
  t.offers=[{id:11,driver_id:2,name:'أحمد — تجريبي',vehicle:'تجربة ١٢٣',price:t.price,rating:4.9},{id:12,driver_id:3,name:'محمد — تجريبي',vehicle:'تجربة ٤٥٦',price:t.price+5,rating:4.8}];demoState.trips.unshift(t);return {id:t.id};
 }
 const match=path.match(/^\/trips\/(\d+)\/(\w+)$/);
 if(match){const id=Number(match[1]),op=match[2],t=[...demoState.trips,...demoState.available].find(x=>x.id===id);
  if(!t)throw new Error('الرحلة غير موجودة');
  if(op==='offer'){t.my_offer=body.price;return {ok:true};}
  if(op==='accept'){const o=t.offers.find(x=>x.id===body.offer_id);t.driver_id=o.driver_id;t.driver={id:o.driver_id,name:o.name,vehicle:o.vehicle,rating:o.rating};t.price=o.price;t.status='accepted';return {ok:true};}
  if(op==='status'){if(body.status==='in_progress'&&body.code!=='1234')throw new Error('كود التجربة 1234');t.status=body.status;t.cancelled_reason=body.reason||'';return {ok:true};}
  if(op==='rating'){t.rated=true;return {ok:true};}
  if(op==='messages'){demoMessages[id]||=[];if(body)demoMessages[id].push({id:Date.now(),user_id:demoState.user.id,name:demoState.user.name,body:body.body,created:Date.now()/1000});return {messages:demoMessages[id]};}
 }
 throw new Error('الإجراء غير متاح في المعاينة');
}
renderLogin();if(token)refresh(true);
setInterval(()=>{if(!document.hidden)refresh();},3000);
