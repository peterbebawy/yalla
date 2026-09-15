# ربط يلا توكتوك بـ Firebase

هذه النسخة تعمل بواجهة GitHub Pages، بينما تسجيل الدخول والبيانات يعملان من Firebase Authentication + Realtime Database.

## 1) إنشاء/اختيار مشروع Firebase

1. افتح Firebase Console واختر مشروعك.
2. Project settings > General > Your apps > Web app.
3. انسخ `firebaseConfig`.
4. افتح `web/firebase-config.js` واستبدل قيم `PUT_YOUR_...` فقط.

> لا تضع Service Account أو Private Key داخل GitHub.

## 2) Authentication

من Firebase Console:

- Security > Authentication > Sign-in method.
- فعّل **Email/Password**.
- من Authentication > Settings > Authorized domains أضف `peterbebawy.github.io` إذا لم يكن موجودًا.

الواجهة تظل تطلب رقم الموبايل. داخليًا يتم تحويل رقم الهاتف إلى بريد تقني ثابت لاستخدام Firebase Email/Password؛ المستخدم لا يرى هذا البريد ولا يحتاج بريدًا حقيقيًا.

## 3) Realtime Database

1. Build > Realtime Database > Create Database.
2. اختر المنطقة المناسبة، وابدأ Locked mode.
3. تأكد أن `databaseURL` الموجود في `web/firebase-config.js` مطابق للرابط الظاهر في Firebase.
4. افتح تبويب Rules وانسخ محتوى `firebase/database.rules.json` ثم Publish.

أو باستخدام Firebase CLI بعد تسجيل الدخول:

```bash
firebase use YOUR_PROJECT_ID
firebase deploy --only database
```

## 4) GitHub Pages

الـ workflow `.github/workflows/pages.yml` ينشر مجلد `web` فقط. في GitHub:

- Settings > Pages > Source = **GitHub Actions**.
- Actions > Publish frontend to GitHub Pages.

الرابط الحالي المتوقع للمستودع المستخدم في المشروع:

`https://peterbebawy.github.io/yalla/`

## 5) إنشاء أول Admin

1. أنشئ حسابًا عاديًا من التطبيق.
2. من Firebase Console > Authentication انسخ UID لهذا الحساب.
3. Realtime Database > `users` > نفس UID.
4. غيّر `role` إلى `admin` و `approved` إلى `true`.
5. سجل خروج ثم دخول من تبويب العميل. التطبيق سيتعرف على الدور كإدارة.

> تعديل الدور بهذه الطريقة يتم من Firebase Console الموثوق، وليس من واجهة المستخدم.

## 6) Android APK

الـ APK هو WebView آمن يفتح موقع GitHub Pages. شغّل workflow **Build Android trial APK** واستخدم:

`https://peterbebawy.github.io/yalla/`

كـ `site_url`. أو افتح مجلد `android` في Android Studio وابنِ APK بعد ضبط Gradle property `yallaUrl`.

## ملاحظات أمنية

- Firebase Web config ليس Private Key، لكن قواعد قاعدة البيانات إلزامية.
- لا تستخدم Test Mode في Realtime Database للإطلاق.
- قبل إطلاق تجاري واسع يفضل إضافة Firebase App Check ومراجعة القواعد بمحاكي Firebase.
- كود بدء الرحلة محفوظ في `tripSecrets` ولا يُقرأ للدريفر؛ قواعد Realtime Database تتحقق من المحاولة عند الانتقال إلى `in_progress`.
