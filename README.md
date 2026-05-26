# WTS Result Management System

**Way To Success Standard Schools**  
Ifedapo Community, Oko/Ijado Road, Ejigbo, Osun State

---

## About

A complete school result management system for recording, computing and generating student academic report cards.

**Features:**
- Student roster management with photos
- Score entry (CA1, CA2, CA3 + Exam) for all subjects
- Auto-computed totals, grades (WAEC scale), and class positions
- Class broadsheet
- Printable individual result cards with digital signature
- School fees tracking
- Affective traits and psychomotor skills rating
- Analytics dashboard
- Customisable settings (school info, grading, remarks, themes)
- All classes: SS1-SS3 (Science/Arts/Business) + JSS1-JSS3

## Classes Supported

| Level | Departments |
|-------|------------|
| SS3 | Science, Arts |
| SS2 | Science, Arts, Business |
| SS1 | Science, Arts, Business |
| JSS3 | A, B |
| JSS2 | A, B |
| JSS1 | A, B |

## Deployment

## Android App

The `android-app` folder contains a native Android WebView app for the result portal.

Build from the repository root with:

```bash
gradle :android-app:assembleDebug
```

The installable APK is created at:

```text
android-app/build/outputs/apk/debug/android-app-debug.apk
```

GitHub Actions can also build the APK from the **Build Android APK** workflow and publish it as a downloadable artifact.

Deployed on [Vercel](https://vercel.com) — automatic deployment on every push to main.

---

*Built with HTML, CSS and JavaScript. No frameworks required.*
