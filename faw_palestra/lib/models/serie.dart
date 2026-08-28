/// Una singola serie eseguita (reps, peso, completata).
///
/// Esempio: 12 reps @ 20kg, completata.
class Serie {
  final int reps;
  final double weight;
  final bool done;
  final int? restSeconds; // secondi di recupero effettivi

  const Serie({
    this.reps = 0,
    this.weight = 0.0,
    this.done = false,
    this.restSeconds,
  });

  factory Serie.fromJson(Map<String, dynamic> json) => Serie(
        reps: (json['reps'] ?? 0) as int,
        weight: (json['weight'] ?? 0).toDouble(),
        done: (json['done'] ?? false) as bool,
        restSeconds: json['rest'] as int?,
      );

  Map<String, dynamic> toJson() => {
        'reps': reps,
        'weight': weight,
        'done': done,
        if (restSeconds != null) 'rest': restSeconds,
      };

  Serie copyWith({int? reps, double? weight, bool? done, int? restSeconds}) {
    return Serie(
      reps: reps ?? this.reps,
      weight: weight ?? this.weight,
      done: done ?? this.done,
      restSeconds: restSeconds ?? this.restSeconds,
    );
  }
}

/// Un esercizio dentro un workout day: quante serie fatte, il target, ecc.
class WorkoutExercise {
  final String exerciseId;
  final String exerciseName;
  final String muscleGroup;
  final int targetSets;
  final int targetReps;
  final double targetWeight;
  final List<Serie> series;

  const WorkoutExercise({
    required this.exerciseId,
    required this.exerciseName,
    required this.muscleGroup,
    this.targetSets = 3,
    this.targetReps = 10,
    this.targetWeight = 0,
    this.series = const [],
  });

  factory WorkoutExercise.fromJson(Map<String, dynamic> json) {
    return WorkoutExercise(
      exerciseId: json['exerciseId'] as String,
      exerciseName: (json['exerciseName'] ?? '') as String,
      muscleGroup: (json['muscleGroup'] ?? '') as String,
      targetSets: (json['targetSets'] ?? 3) as int,
      targetReps: (json['targetReps'] ?? 10) as int,
      targetWeight: (json['targetWeight'] ?? 0).toDouble(),
      series: (json['series'] as List? ?? [])
          .map((e) => Serie.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'exerciseId': exerciseId,
        'exerciseName': exerciseName,
        'muscleGroup': muscleGroup,
        'targetSets': targetSets,
        'targetReps': targetReps,
        'targetWeight': targetWeight,
        'series': series.map((s) => s.toJson()).toList(),
      };

  int get completedSets => series.where((s) => s.done).length;
  double get totalVolume =>
      series.where((s) => s.done).fold(0.0, (a, s) => a + s.reps * s.weight);
  bool get isComplete => completedSets >= targetSets;
}
