import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import 'firebase_service.dart';
import 'providers.dart';

/// Stato di una sessione di allenamento in corso.
class ActiveSession {
  final WorkoutDay day;
  final DateTime startTime;
  final List<WorkoutExercise> exercises;
  final int currentExerciseIdx;
  final int? activeRestTimerStartedAt; // ms epoch when current rest started

  const ActiveSession({
    required this.day,
    required this.startTime,
    required this.exercises,
    this.currentExerciseIdx = 0,
    this.activeRestTimerStartedAt,
  });

  ActiveSession copyWith({
    List<WorkoutExercise>? exercises,
    int? currentExerciseIdx,
    int? activeRestTimerStartedAt,
    bool clearRestTimer = false,
  }) {
    return ActiveSession(
      day: day,
      startTime: startTime,
      exercises: exercises ?? this.exercises,
      currentExerciseIdx: currentExerciseIdx ?? this.currentExerciseIdx,
      activeRestTimerStartedAt: clearRestTimer
          ? null
          : (activeRestTimerStartedAt ?? this.activeRestTimerStartedAt),
    );
  }

  Duration get elapsed => DateTime.now().difference(startTime);

  int get completedSets =>
      exercises.fold(0, (a, e) => a + e.series.where((s) => s.done).length);

  double get totalVolume => exercises.fold(
      0.0, (a, e) => a + e.series.where((s) => s.done).fold(0.0, (b, s) => b + s.reps * s.weight));

  WorkoutExercise get currentExercise => exercises[currentExerciseIdx];

  bool get isComplete => currentExerciseIdx >= exercises.length;
}

/// Notifier per gestire la sessione attiva.
class ActiveSessionNotifier extends StateNotifier<AsyncValue<ActiveSession?>> {
  ActiveSessionNotifier(this._ref) : super(const AsyncValue.data(null));

  final Ref _ref;

  void start(WorkoutDay day) {
    // Copia profonda per non mutare l'originale
    final exercises = day.exercises
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
                        done: s.done,
                        restSeconds: s.restSeconds,
                      ))
                  .toList(),
            ))
        .toList();

    state = AsyncValue.data(ActiveSession(
      day: day,
      startTime: DateTime.now(),
      exercises: exercises,
    ));
  }

  void markSetDone(int exIdx, int setIdx, {int? reps, double? weight, int? restSec}) {
    final s = state.valueOrNull;
    if (s == null) return;
    final newEx = [...s.exercises];
    final ex = newEx[exIdx];
    final newSeries = [...ex.series];
    newSeries[setIdx] = newSeries[setIdx].copyWith(
      done: true,
      reps: reps ?? newSeries[setIdx].reps,
      weight: weight ?? newSeries[setIdx].weight,
      restSeconds: restSec,
    );
    newEx[exIdx] = ex.copyWith(series: newSeries);
    state = AsyncValue.data(s.copyWith(
      exercises: newEx,
      activeRestTimerStartedAt: DateTime.now().millisecondsSinceEpoch,
    ));
  }

  void updateSet(int exIdx, int setIdx, {int? reps, double? weight}) {
    final s = state.valueOrNull;
    if (s == null) return;
    final newEx = [...s.exercises];
    final ex = newEx[exIdx];
    final newSeries = [...ex.series];
    newSeries[setIdx] = newSeries[setIdx].copyWith(
      reps: reps,
      weight: weight,
    );
    newEx[exIdx] = ex.copyWith(series: newSeries);
    state = AsyncValue.data(s.copyWith(exercises: newEx));
  }

  void addSet(int exIdx) {
    final s = state.valueOrNull;
    if (s == null) return;
    final newEx = [...s.exercises];
    final ex = newEx[exIdx];
    final last = ex.series.isNotEmpty ? ex.series.last : null;
    final newSeries = [
      ...ex.series,
      Serie(
        reps: last?.reps ?? ex.targetReps,
        weight: last?.weight ?? ex.targetWeight,
      ),
    ];
    newEx[exIdx] = ex.copyWith(series: newSeries);
    state = AsyncValue.data(s.copyWith(exercises: newEx));
  }

  void removeSet(int exIdx, int setIdx) {
    final s = state.valueOrNull;
    if (s == null) return;
    final newEx = [...s.exercises];
    final ex = newEx[exIdx];
    if (ex.series.length <= 1) return;
    final newSeries = [...ex.series]..removeAt(setIdx);
    newEx[exIdx] = ex.copyWith(series: newSeries);
    state = AsyncValue.data(s.copyWith(exercises: newEx));
  }

  void nextExercise() {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncValue.data(s.copyWith(
      currentExerciseIdx: s.currentExerciseIdx + 1,
      clearRestTimer: true,
    ));
  }

  void prevExercise() {
    final s = state.valueOrNull;
    if (s == null || s.currentExerciseIdx == 0) return;
    state = AsyncValue.data(s.copyWith(
      currentExerciseIdx: s.currentExerciseIdx - 1,
      clearRestTimer: true,
    ));
  }

  void clearRestTimer() {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncValue.data(s.copyWith(clearRestTimer: true));
  }

  /// Salva la sessione su Firestore come WorkoutLog + aggiorna i days.
  Future<void> finish(String userNome) async {
    final s = state.valueOrNull;
    if (s == null) return;
    if (s.completedSets == 0) {
      // Niente da salvare
      state = const AsyncValue.data(null);
      return;
    }

    final log = WorkoutLog(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      dayId: s.day.id,
      dayName: s.day.name,
      dt: s.startTime,
      totalSets: s.completedSets,
      totalVolume: s.totalVolume,
      durationSec: s.elapsed.inSeconds,
      exercises: s.exercises,
    );

    final fb = _ref.read(firebaseServiceProvider);
    final user = await fb.loadUser(userNome);
    if (user == null) {
      state = const AsyncValue.data(null);
      return;
    }
    // Aggiorna il day con le serie fatte + aggiungi al log
    final newDays = user.days.map((d) {
      if (d.id != s.day.id) return d;
      return d.copyWith(
        lastPerformed: s.startTime,
        exercises: s.exercises,
      );
    }).toList();
    final newHist = [log, ...user.hist];
    await fb.saveUser(user.copyWith(days: newDays, hist: newHist));

    state = const AsyncValue.data(null);
  }

  void cancel() {
    state = const AsyncValue.data(null);
  }
}

final activeSessionProvider =
    StateNotifierProvider<ActiveSessionNotifier, AsyncValue<ActiveSession?>>(
        (ref) => ActiveSessionNotifier(ref));
