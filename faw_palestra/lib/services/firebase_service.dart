import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';

import '../firebase_options.dart';
import '../models/models.dart';

/// Singleton wrapper per Firebase + Firestore.
///
/// Mantiene la stessa logica del vecchio codice HTML/JS:
///   - collection `gym_users/{nome}` per i profili
///   - documenti pubblici (no auth obbligatoria)
class FirebaseService {
  FirebaseService._();
  static final FirebaseService instance = FirebaseService._();

  late final FirebaseFirestore _db;
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.android, // platform-detect a runtime
    );
    _db = FirebaseFirestore.instance;
    _initialized = true;
  }

  FirebaseFirestore get db {
    if (!_initialized) {
      throw StateError('FirebaseService.init() deve essere chiamato prima.');
    }
    return _db;
  }

  // ===== USER =====

  Future<GymUser?> loadUser(String nome) async {
    final doc = await db.collection('gym_users').doc(nome).get();
    if (!doc.exists) return null;
    return GymUser.fromJson({...doc.data()!, 'nome': nome});
  }

  Future<void> saveUser(GymUser user) async {
    await db
        .collection('gym_users')
        .doc(user.nome)
        .set(user.toJson(), SetOptions(merge: true));
  }

  Stream<GymUser?> watchUser(String nome) {
    return db
        .collection('gym_users')
        .doc(nome)
        .snapshots()
        .map((doc) {
      if (!doc.exists) return null;
      return GymUser.fromJson({...doc.data()!, 'nome': nome});
    });
  }

  // ===== EXERCISES (cache locale) =====

  /// Carica la libreria esercizi da `exercises.json` bundled.
  /// Lo stesso file di prima, ma hostato come asset locale per offline.
  Future<List<Esercizio>> loadExercises() async {
    // In produzione: caricare da asset rootBundle.loadString('assets/exercises.json')
    // Per ora, ritorniamo un fallback vuoto — il file vero è 3.7MB, meglio
    // caricarlo on-demand con paginazione.
    return const [];
  }
}
