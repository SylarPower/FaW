import 'package:uuid/uuid.dart';

import '../models/models.dart';

/// Template di workout days predefiniti, utili per iniziare velocemente.
///
/// Le keywords vengono usate per matchare con gli esercizi reali della
/// libreria (case-insensitive contains).
class WorkoutTemplate {
  final String name;
  final String icon;
  final List<TemplateExercise> exercises;

  const WorkoutTemplate({
    required this.name,
    required this.icon,
    required this.exercises,
  });
}

class TemplateExercise {
  final String nameKeyword; // match con Esercizio.name
  final int targetSets;
  final int targetReps;
  final double targetWeight;

  const TemplateExercise({
    required this.nameKeyword,
    this.targetSets = 3,
    this.targetReps = 10,
    this.targetWeight = 0,
  });
}

class WorkoutTemplates {
  static const _uuid = Uuid();

  static const all = <WorkoutTemplate>[
    WorkoutTemplate(
      name: 'Push Day',
      icon: '💪',
      exercises: [
        TemplateExercise(nameKeyword: 'panca piana', targetSets: 4, targetReps: 8, targetWeight: 60),
        TemplateExercise(nameKeyword: 'panca inclinata', targetSets: 3, targetReps: 10, targetWeight: 50),
        TemplateExercise(nameKeyword: 'spinte', targetSets: 3, targetReps: 12, targetWeight: 16),
        TemplateExercise(nameKeyword: 'lento avanti', targetSets: 3, targetReps: 10, targetWeight: 30),
        TemplateExercise(nameKeyword: 'alzate laterali', targetSets: 3, targetReps: 15, targetWeight: 8),
        TemplateExercise(nameKeyword: 'tricipiti', targetSets: 3, targetReps: 12, targetWeight: 20),
      ],
    ),
    WorkoutTemplate(
      name: 'Pull Day',
      icon: '🔙',
      exercises: [
        TemplateExercise(nameKeyword: 'stacco', targetSets: 4, targetReps: 6, targetWeight: 80),
        TemplateExercise(nameKeyword: 'rematore', targetSets: 4, targetReps: 10, targetWeight: 50),
        TemplateExercise(nameKeyword: 'lat machine', targetSets: 3, targetReps: 12, targetWeight: 40),
        TemplateExercise(nameKeyword: 'pulldown', targetSets: 3, targetReps: 12, targetWeight: 35),
        TemplateExercise(nameKeyword: 'curl bilanciere', targetSets: 3, targetReps: 12, targetWeight: 25),
        TemplateExercise(nameKeyword: 'curl manubri', targetSets: 3, targetReps: 12, targetWeight: 12),
      ],
    ),
    WorkoutTemplate(
      name: 'Leg Day',
      icon: '🦵',
      exercises: [
        TemplateExercise(nameKeyword: 'squat', targetSets: 4, targetReps: 8, targetWeight: 80),
        TemplateExercise(nameKeyword: 'affondi', targetSets: 3, targetReps: 12, targetWeight: 16),
        TemplateExercise(nameKeyword: 'leg press', targetSets: 3, targetReps: 12, targetWeight: 120),
        TemplateExercise(nameKeyword: 'leg curl', targetSets: 3, targetReps: 12, targetWeight: 40),
        TemplateExercise(nameKeyword: 'leg extension', targetSets: 3, targetReps: 12, targetWeight: 50),
        TemplateExercise(nameKeyword: 'polpacci', targetSets: 4, targetReps: 15, targetWeight: 60),
      ],
    ),
    WorkoutTemplate(
      name: 'Full Body',
      icon: '🏋️',
      exercises: [
        TemplateExercise(nameKeyword: 'squat', targetSets: 3, targetReps: 10, targetWeight: 60),
        TemplateExercise(nameKeyword: 'panca piana', targetSets: 3, targetReps: 10, targetWeight: 50),
        TemplateExercise(nameKeyword: 'rematore', targetSets: 3, targetReps: 10, targetWeight: 40),
        TemplateExercise(nameKeyword: 'lento avanti', targetSets: 3, targetReps: 10, targetWeight: 25),
        TemplateExercise(nameKeyword: 'plank', targetSets: 3, targetReps: 60, targetWeight: 0),
      ],
    ),
    WorkoutTemplate(
      name: 'Upper Body',
      icon: '💎',
      exercises: [
        TemplateExercise(nameKeyword: 'panca', targetSets: 4, targetReps: 8, targetWeight: 55),
        TemplateExercise(nameKeyword: 'rematore', targetSets: 4, targetReps: 8, targetWeight: 50),
        TemplateExercise(nameKeyword: 'lento', targetSets: 3, targetReps: 10, targetWeight: 25),
        TemplateExercise(nameKeyword: 'trazioni', targetSets: 3, targetReps: 8, targetWeight: 0),
        TemplateExercise(nameKeyword: 'curl', targetSets: 3, targetReps: 12, targetWeight: 20),
      ],
    ),
    WorkoutTemplate(
      name: 'Cardio HIIT',
      icon: '🔥',
      exercises: [
        TemplateExercise(nameKeyword: 'burpees', targetSets: 4, targetReps: 15, targetWeight: 0),
        TemplateExercise(nameKeyword: 'mountain climber', targetSets: 4, targetReps: 30, targetWeight: 0),
        TemplateExercise(nameKeyword: 'jumping jack', targetSets: 4, targetReps: 30, targetWeight: 0),
        TemplateExercise(nameKeyword: 'kettlebell', targetSets: 4, targetReps: 15, targetWeight: 16),
      ],
    ),
  ];

  /// Crea un WorkoutDay partendo da un template, risolvendo gli esercizi
  /// dalla libreria. Restituisce null se nessun esercizio matcha.
  static WorkoutDay fromTemplate(
    WorkoutTemplate template,
    List<Esercizio> library,
  ) {
    final resolved = <WorkoutExercise>[];
    for (final tEx in template.exercises) {
      final match = _findMatch(library, tEx.nameKeyword);
      if (match == null) continue;
      resolved.add(WorkoutExercise(
        exerciseId: match.id,
        exerciseName: match.name,
        muscleGroup: match.macroGroup,
        targetSets: tEx.targetSets,
        targetReps: tEx.targetReps,
        targetWeight: tEx.targetWeight,
        series: List.generate(
          tEx.targetSets,
          (i) => Serie(
            reps: tEx.targetReps,
            weight: tEx.targetWeight,
          ),
        ),
      ));
    }
    return WorkoutDay(
      id: _uuid.v4(),
      name: template.name,
      icon: template.icon,
      exercises: resolved,
    );
  }

  static Esercizio? _findMatch(List<Esercizio> library, String keyword) {
    final k = keyword.toLowerCase();
    // Match esatto
    for (final ex in library) {
      if (ex.name.toLowerCase() == k) return ex;
    }
    // Contains
    for (final ex in library) {
      if (ex.name.toLowerCase().contains(k)) return ex;
    }
    return null;
  }

  /// Genera un nuovo ID workout day.
  static String newId() => _uuid.v4();
}
