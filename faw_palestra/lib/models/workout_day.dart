import 'serie.dart';

/// Un "giorno" di allenamento: push day, pull day, leg day, full body, ecc.
class WorkoutDay {
  final String id;
  final String name;
  final String icon; // emoji
  final List<WorkoutExercise> exercises;
  final DateTime? lastPerformed;

  const WorkoutDay({
    required this.id,
    required this.name,
    this.icon = '💪',
    this.exercises = const [],
    this.lastPerformed,
  });

  factory WorkoutDay.fromJson(Map<String, dynamic> json) {
    return WorkoutDay(
      id: json['id'] as String,
      name: json['name'] as String,
      icon: (json['icon'] ?? '💪') as String,
      lastPerformed: json['lastPerformed'] != null
          ? DateTime.parse(json['lastPerformed'] as String)
          : null,
      exercises: (json['exercises'] as List? ?? [])
          .map((e) => WorkoutExercise.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'icon': icon,
        if (lastPerformed != null)
          'lastPerformed': lastPerformed!.toIso8601String(),
        'exercises': exercises.map((e) => e.toJson()).toList(),
      };

  WorkoutDay copyWith({
    String? name,
    String? icon,
    DateTime? lastPerformed,
    List<WorkoutExercise>? exercises,
  }) {
    return WorkoutDay(
      id: id,
      name: name ?? this.name,
      icon: icon ?? this.icon,
      lastPerformed: lastPerformed ?? this.lastPerformed,
      exercises: exercises ?? this.exercises,
    );
  }

  int get totalSets =>
      exercises.fold(0, (a, e) => a + e.series.where((s) => s.done).length);
  int get totalExercises => exercises.length;
}

/// Log di una sessione completata (per storico/statistiche).
class WorkoutLog {
  final String id;
  final String dayId;
  final String dayName;
  final DateTime dt;
  final int totalSets;
  final double totalVolume;
  final int durationSec;
  final List<WorkoutExercise> exercises;

  const WorkoutLog({
    required this.id,
    required this.dayId,
    required this.dayName,
    required this.dt,
    this.totalSets = 0,
    this.totalVolume = 0,
    this.durationSec = 0,
    this.exercises = const [],
  });

  factory WorkoutLog.fromJson(Map<String, dynamic> json) => WorkoutLog(
        id: json['id'] as String,
        dayId: json['dayId'] as String,
        dayName: json['dayName'] as String,
        dt: DateTime.parse(json['dt'] as String),
        totalSets: (json['totalSets'] ?? 0) as int,
        totalVolume: (json['totalVolume'] ?? 0).toDouble(),
        durationSec: (json['durationSec'] ?? 0) as int,
        exercises: (json['exercises'] as List? ?? [])
            .map((e) => WorkoutExercise.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'dayId': dayId,
        'dayName': dayName,
        'dt': dt.toIso8601String(),
        'totalSets': totalSets,
        'totalVolume': totalVolume,
        'durationSec': durationSec,
        'exercises': exercises.map((e) => e.toJson()).toList(),
      };
}
