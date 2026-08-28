# FaW Palestra - Flutter App

App nativa Android (e iOS) per il tracciamento degli allenamenti in palestra.
Migrazione del vecchio progetto HTML/JS/Firebase (`games/palestra/index.html`).

## Stack

- **Framework**: Flutter 3.16+ (Dart 3.0+)
- **State management**: Riverpod
- **Backend**: Firebase (Firestore, Auth, Storage, Analytics, Crashlytics)
- **Video**: `video_player` + `chewie` (ExoPlayer su Android, AVPlayer su iOS)
- **Charts**: `fl_chart` (sostituisce chart.js)

## Struttura

```
lib/
├── main.dart                  # Entry point + tema
├── firebase_options.dart      # Config Firebase (generata da flutterfire)
├── models/
│   ├── esercizio.dart         # Esercizio dalla libreria
│   ├── serie.dart             # Serie + WorkoutExercise
│   ├── workout_day.dart       # WorkoutDay + WorkoutLog
│   └── gym_user.dart          # Profilo utente
├── services/
│   ├── firebase_service.dart  # Wrapper Firestore
│   ├── exercise_service.dart  # Cache esercizi da JSON
│   ├── auth_service.dart      # Nome utente (SharedPreferences)
│   └── providers.dart         # Riverpod providers
├── screens/
│   ├── login_screen.dart
│   ├── home_screen.dart
│   ├── workout_day_detail.dart
│   ├── exercise_picker_screen.dart
│   └── exercise_detail_screen.dart
├── widgets/
│   ├── stat_chip.dart
│   └── exercise_card.dart
└── theme/
    └── app_theme.dart         # Tema dark/light
```

## Setup (sul tuo PC)

### Prerequisiti

1. **Flutter SDK** >= 3.16
   ```bash
   # Installa: https://docs.flutter.dev/get-started/install
   flutter --version
   ```

2. **Android Studio** (per SDK Android + emulator)
   - https://developer.android.com/studio
   - Installa Android SDK 34, build-tools, platform-tools

3. **Java 17** (per Gradle)
   ```bash
   java --version  # deve essere 17+
   ```

### Setup progetto

```bash
# 1. Clona/scarica questo progetto
cd faw_palestra

# 2. Installa dipendenze
flutter pub get

# 3. Genera config Firebase per Android+iOS
dart pub global activate flutterfire_cli
flutterfire configure
# → crea android/app/google-services.json
# → crea ios/Runner/GoogleService-Info.plist
# → aggiorna lib/firebase_options.dart

# 4. Testa che compili
flutter doctor
flutter run   # connetti un telefono o avvia un emulatore
```

### Build APK

```bash
# Debug (per test locale)
flutter build apk --debug
# → build/app/outputs/flutter-apk/app-debug.apk

# Release (per Play Store)
flutter build apk --release
flutter build appbundle --release  # .aab richiesto da Play Store
```

### Build iOS (futuro, serve Mac)

```bash
cd ios && pod install && cd ..
flutter build ios --release
# Apri ios/Runner.xcworkspace in Xcode per signing e upload
```

## Differenze con la versione HTML

| Aspetto | HTML/JS | Flutter |
|---|---|---|
| Linguaggio | JavaScript | Dart |
| UI | DOM + CSS | Widget tree |
| Video | `<video>` | `video_player` (ExoPlayer nativo) |
| Persistenza | localStorage | SharedPreferences + Firestore |
| Grafica | Chart.js | fl_chart |
| Performance | Media (browser) | Nativa (60-120 FPS) |
| Bundle | ~3 MB (cached) | ~15 MB (release APK) |
| Play Store | ❌ (rifiutato) | ✅ |
| App Store | ❌ | ✅ (con build iOS) |

## Cosa è già fatto

✅ Modelli dati (Esercizio, Serie, WorkoutDay, GymUser)
✅ Tema dark/light con colori originali
✅ Login (nome utente)
✅ Home con statistiche e lista workout days
✅ Dettaglio workout day
✅ Picker esercizi (con ricerca e filtri per gruppo)
✅ Dettaglio esercizio (con video player)
✅ Firebase service (Firestore CRUD)
✅ Exercise service (cache locale del JSON)
✅ Riverpod state management
✅ Android manifest + build.gradle
✅ iOS Info.plist + Podfile

## TODO

- [ ] Timer recupero tra serie
- [ ] Statistiche avanzate (grafici settimanali, PR records)
- [ ] Notifiche push ("È ora di allenarsi!")
- [ ] Sincronizzazione workout days su Firestore
- [ ] Auth Firebase (Google Sign-In + Apple Sign-In per iOS)
- [ ] Onboarding per primo utente
- [ ] Export dati (CSV/PDF)
- [ ] Widget per home screen
- [ ] Wear OS companion app (opzionale)
