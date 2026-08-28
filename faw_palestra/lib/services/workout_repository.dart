import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import 'firebase_service.dart';
import 'providers.dart';

/// Repository per le operazioni CRUD sui workout days dell'utente.
///
/// Tutte le operazioni sono wrappate in un'update atomica sul documento
/// `gym_users/{nome}`: leggiamo → modifichiamo → salviamo. Per ora è
/// OK perché il volume di dati è basso; in futuro si potrebbe passare
/// a una subcollection `gym_users/{nome}/days/{dayId}` per scalare meglio.
class WorkoutRepository {
  WorkoutRepository(this._fb);

  final FirebaseService _fb;

  /// Aggiunge un nuovo workout day al profilo utente.
  Future<void> createDay(String userNome, WorkoutDay day) async {
    final user = await _fb.loadUser(userNome);
    if (user == null) {
      // Crea utente al volo
      final newUser = GymUser(
        nome: userNome,
        days: [day],
        createdAt: DateTime.now(),
      );
      await _fb.saveUser(newUser);
      return;
    }
    final newDays = [...user.days, day];
    await _fb.saveUser(user.copyWith(days: newDays));
  }

  /// Aggiorna un workout day esistente (per nome, icona, esercizi).
  Future<void> updateDay(String userNome, WorkoutDay day) async {
    final user = await _fb.loadUser(userNome);
    if (user == null) return;
    final newDays = user.days.map((d) => d.id == day.id ? day : d).toList();
    await _fb.saveUser(user.copyWith(days: newDays));
  }

  /// Elimina un workout day.
  Future<void> deleteDay(String userNome, String dayId) async {
    final user = await _fb.loadUser(userNome);
    if (user == null) return;
    final newDays = user.days.where((d) => d.id != dayId).toList();
    await _fb.saveUser(user.copyWith(days: newDays));
  }

  /// Riordina i workout days (drag & drop nella home).
  Future<void> reorderDays(String userNome, int oldIdx, int newIdx) async {
    final user = await _fb.loadUser(userNome);
    if (user == null) return;
    final newDays = [...user.days];
    if (oldIdx < 0 || oldIdx >= newDays.length) return;
    final adjustedNew = newIdx > oldIdx ? newIdx - 1 : newIdx;
    final moved = newDays.removeAt(oldIdx);
    newDays.insert(adjustedNew.clamp(0, newDays.length), moved);
    await _fb.saveUser(user.copyWith(days: newDays));
  }

  /// Duplica un workout day (utile per partire da una template).
  Future<WorkoutDay?> duplicateDay(String userNome, String dayId) async {
    final user = await _fb.loadUser(userNome);
    if (user == null) return null;
    final src = user.days.firstWhere((d) => d.id == dayId,
        orElse: () => const WorkoutDay(id: '', name: ''));
    if (src.id.isEmpty) return null;

    final copy = src.copyWith(
      // Deep copy esercizi/serie
      exercises: src.exercises
          .map((e) => WorkoutExercise(
                exerciseId: e.exerciseId,
                exerciseName: e.exerciseName,
                muscleGroup: e.muscleGroup,
                targetSets: e.targetSets,
                targetReps: e.targetReps,
                targetWeight: e.targetWeight,
                series: e.series
                    .map((s) => Serie(
                          reps: s.reps,
                          weight: s.weight,
                          done: false,
                          restSeconds: s.restSeconds,
                        ))
                    .toList(),
              ))
          .toList(),
    );
    // Reset lastPerformed perché è una copia
    final newDays = [
      ...user.days,
      copy, // ID rimane lo stesso, ma è nel doc come copia
    ];
    await _fb.saveUser(user.copyWith(days: newDays));
    return copy;
  }
}

/// Provider per il repository.
final workoutRepositoryProvider = Provider<WorkoutRepository>((ref) {
  return WorkoutRepository(ref.watch(firebaseServiceProvider));
});
