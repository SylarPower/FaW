import 'workout_day.dart';

/// Profilo utente palestra su Firestore (`gym_users/{nome}`).
///
/// Stessa struttura del vecchio `D` (localStorage nel progetto HTML).
class GymUser {
  final String nome;
  final List<WorkoutDay> days;
  final List<WorkoutLog> hist;
  final DateTime? createdAt;

  const GymUser({
    required this.nome,
    this.days = const [],
    this.hist = const [],
    this.createdAt,
  });

  factory GymUser.fromJson(Map<String, dynamic> json) {
    return GymUser(
      nome: (json['nome'] ?? json['id'] ?? '') as String,
      days: (json['days'] as List? ?? [])
          .map((e) => WorkoutDay.fromJson(e as Map<String, dynamic>))
          .toList(),
      hist: (json['hist'] as List? ?? [])
          .map((e) => WorkoutLog.fromJson(e as Map<String, dynamic>))
          .toList(),
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'nome': nome,
        'days': days.map((d) => d.toJson()).toList(),
        'hist': hist.map((h) => h.toJson()).toList(),
        if (createdAt != null) 'createdAt': createdAt!.toIso8601String(),
      };

  GymUser copyWith({
    List<WorkoutDay>? days,
    List<WorkoutLog>? hist,
  }) {
    return GymUser(
      nome: nome,
      days: days ?? this.days,
      hist: hist ?? this.hist,
      createdAt: createdAt,
    );
  }

  /// Statistiche settimanali: totale serie, gruppi muscolari toccati, ecc.
  int get weeklySets {
    final monday = _mondayOfWeek(DateTime.now());
    return hist
        .where((h) => h.dt.isAfter(monday))
        .fold(0, (a, h) => a + h.totalSets);
  }

  double get weeklyVolume {
    final monday = _mondayOfWeek(DateTime.now());
    return hist
        .where((h) => h.dt.isAfter(monday))
        .fold(0.0, (a, h) => a + h.totalVolume);
  }

  static DateTime _mondayOfWeek(DateTime d) {
    final diff = d.weekday - DateTime.monday;
    return DateTime(d.year, d.month, d.day).subtract(Duration(days: diff));
  }
}
