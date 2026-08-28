// File generated conceptually by `flutterfire configure`.
// In produzione questo file viene generato automaticamente quando lanci
// `flutterfire configure` sul tuo PC dopo aver scaricato il progetto.
// Per ora contiene i valori del vecchio `games/shared/firebase-config.js`.

class DefaultFirebaseOptions {
  static const android = FirebaseOptions(
    apiKey: 'AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc',
    appId: '1:798226885203:android:ce83f4d9e96b82266274a6', // placeholder, rigenera con flutterfire
    messagingSenderId: '798226885203',
    projectId: 'funatwork-cd237',
    databaseURL:
        'https://funatwork-cd237-default-rtdb.europe-west1.firebasedatabase.app',
    storageBucket: 'funatwork-cd237.appspot.com',
  );

  static const ios = FirebaseOptions(
    apiKey: 'AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc',
    appId: '1:798226885203:ios:ce83f4d9e96b82266274a6', // placeholder, rigenera con flutterfire
    messagingSenderId: '798226885203',
    projectId: 'funatwork-cd237',
    databaseURL:
        'https://funatwork-cd237-default-rtdb.europe-west1.firebasedatabase.app',
    iosBundleId: 'com.faw.palestra',
    storageBucket: 'funatwork-cd237.appspot.com',
  );
}

class FirebaseOptions {
  final String apiKey;
  final String appId;
  final String messagingSenderId;
  final String projectId;
  final String? databaseURL;
  final String? storageBucket;
  final String? iosBundleId;

  const FirebaseOptions({
    required this.apiKey,
    required this.appId,
    required this.messagingSenderId,
    required this.projectId,
    this.databaseURL,
    this.storageBucket,
    this.iosBundleId,
  });
}
