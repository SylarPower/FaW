import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../models/models.dart';
import 'providers.dart';
import 'workout_repository.dart';

/// Stato del form per creare/modificare un workout day.
class WorkoutEditorState {
  final String? dayId; // null = creazione
  final String name;
  final String icon;
  final List<WorkoutExercise> exercises;
  final bool dirty;
  final bool saving;
  final String? error;

  const WorkoutEditorState({
    this.dayId,
    this.name = '',
    this.icon = '💪',
    this.exercises = const [],
    this.dirty = false,
    this.saving = false,
    this.error,
  });

  bool get isValid => name.trim().isNotEmpty && exercises.isNotEmpty;
  bool get isNew => dayId == null;

  WorkoutEditorState copyWith({
    String? name,
    String? icon,
    List<WorkoutExercise>? exercises,
    bool? dirty,
    bool? saving,
    String? error,
    bool clearError = false,
  }) {
    return WorkoutEditorState(
      dayId: dayId,
      name: name ?? this.name,
      icon: icon ?? this.icon,
      exercises: exercises ?? this.exercises,
      dirty: dirty ?? this.dirty,
      saving: saving ?? this.saving,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class WorkoutEditorNotifier extends StateNotifier<WorkoutEditorState> {
  WorkoutEditorNotifier(this._ref) : super(const WorkoutEditorState());

  final Ref _ref;
  static const _uuid = Uuid();

  /// Inizializza per la creazione.
  void initNew() {
    state = const WorkoutEditorState(dirty: false);
  }

  /// Inizializza per la modifica di un day esistente.
  void initFrom(WorkoutDay day) {
    state = WorkoutEditorState(
      dayId: day.id,
      name: day.name,
      icon: day.icon,
      // Deep copy per non mutare l'originale
      exercises: day.exercises
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
                          done: false, // reset stato completamento
                          restSeconds: s.restSeconds,
                        ))
                    .toList(),
              ))
          .toList(),
    );
  }

  void setName(String name) {
    state = state.copyWith(name: name, dirty: true);
  }

  void setIcon(String icon) {
    state = state.copyWith(icon: icon, dirty: true);
  }

  void addExercise(Esercizio ex) {
    final newEx = WorkoutExercise(
      exerciseId: ex.id,
      exerciseName: ex.name,
      muscleGroup: ex.macroGroup,
      targetSets: 3,
      targetReps: 10,
      targetWeight: 0,
      series: List.generate(3, (_) => const Serie(reps: 10, weight: 0)),
    );
    state = state.copyWith(
      exercises: [...state.exercises, newEx],
      dirty: true,
    );
  }

  void removeExercise(int idx) {
    final newEx = [...state.exercises]..removeAt(idx);
    state = state.copyWith(exercises: newEx, dirty: true);
  }

  void reorderExercises(int oldIdx, int newIdx) {
    final newEx = [...state.exercises];
    if (oldIdx < 0 || oldIdx >= newEx.length) return;
    final adjustedNew = newIdx > oldIdx ? newIdx - 1 : newIdx;
    final moved = newEx.removeAt(oldIdx);
    newEx.insert(adjustedNew.clamp(0, newEx.length), moved);
    state = state.copyWith(exercises: newEx, dirty: true);
  }

  void updateExerciseTarget(
    int idx, {
    int? targetSets,
    int? targetReps,
    double? targetWeight,
  }) {
    final newEx = [...state.exercises];
    final ex = newEx[idx];
    final newSeries = List.generate(
      targetSets ?? ex.targetSets,
      (i) {
        if (i < ex.series.length) {
          return ex.series[i].copyWith(
            reps: targetReps ?? ex.series[i].reps,
            weight: targetWeight ?? ex.series[i].weight,
          );
        }
        return Serie(
          reps: targetReps ?? ex.targetReps,
          weight: targetWeight ?? ex.targetWeight,
        );
      },
    );
    newEx[idx] = ex.copyWith(
      targetSets: targetSets ?? ex.targetSets,
      targetReps: targetReps ?? ex.targetReps,
      targetWeight: targetWeight ?? ex.targetWeight,
      series: newSeries,
    );
    state = state.copyWith(exercises: newEx, dirty: true);
  }

  /// Salva (create o update) su Firestore.
  Future<bool> save() async {
    if (!state.isValid) {
      state = state.copyWith(error: 'Inserisci nome e almeno un esercizio');
      return false;
    }
    state = state.copyWith(saving: true, clearError: true);
    try {
      final nome = _ref.read(currentUserProvider).valueOrNull;
      if (nome == null) {
        state = state.copyWith(saving: false, error: 'Utente non loggato');
        return false;
      }
      final repo = _ref.read(workoutRepositoryProvider);
      final day = WorkoutDay(
        id: state.dayId ?? _uuid.v4(),
        name: state.name.trim(),
        icon: state.icon,
        exercises: state.exercises,
      );
      if (state.isNew) {
        await repo.createDay(nome, day);
      } else {
        await repo.updateDay(nome, day);
      }
      state = state.copyWith(saving: false, dirty: false);
      return true;
    } catch (e) {
      state = state.copyWith(saving: false, error: e.toString());
      return false;
    }
  }
}

final workoutEditorProvider =
    StateNotifierProvider.autoDispose<WorkoutEditorNotifier, WorkoutEditorState>(
  (ref) => WorkoutEditorNotifier(ref),
);
