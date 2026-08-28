/// Modello dati per un esercizio della palestra.
///
/// Derivato dal vecchio `exercises.json` (2539 entries).
/// Ogni esercizio ha id, nome, gruppo muscolare, attrezzatura e uno o più
/// video dimostrativi (URL esterni a musclewiki.com).
class Esercizio {
  final String id;
  final String name;
  final String muscle;
  final String eq;
  final List<String> media;

  const Esercizio({
    required this.id,
    required this.name,
    required this.muscle,
    required this.eq,
    required this.media,
  });

  /// Parsing da JSON (lo stesso formato del vecchio exercises.json).
  factory Esercizio.fromJson(Map<String, dynamic> json) {
    return Esercizio(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      muscle: (json['muscle'] ?? '').toString(),
      eq: (json['eq'] ?? '').toString(),
      // Alcune entry malformate hanno `media` come stringa concatenata
      // con virgole invece che array: gestiamo entrambi i casi.
      media: _parseMedia(json['media']),
    );
  }

  static List<String> _parseMedia(dynamic raw) {
    if (raw == null) return const [];
    if (raw is List) {
      return raw.map((e) => e.toString().trim()).where((s) => s.isNotEmpty).toList();
    }
    if (raw is String) {
      // Esempio malformato: "Bilanciere,https://...mp4,https://...mp4"
      return raw
          .split(',')
          .map((e) => e.trim())
          .where((s) => s.startsWith('http'))
          .toList();
    }
    return const [];
  }

  /// Primo video utile per la preview.
  String? get videoUrl => media.isNotEmpty ? media.first : null;

  /// Gruppo muscolare "macro" (es. "Bicipiti" → "Bicipiti", "Dorsali" → "Schiena").
  /// Usato per i filtri rapidi nella home.
  String get macroGroup {
    const map = {
      'Bicipiti': 'Bicipiti',
      'Tricipiti': 'Tricipiti',
      'Avambracci': 'Avambracci',
      'Estensori del polso': 'Avambracci',
      'Flessori del polso': 'Avambracci',
      'Dorsali': 'Schiena',
      'Trapezi': 'Schiena',
      'Lombari': 'Schiena',
      'Zona lombare': 'Schiena',
      'Petto': 'Petto',
      'Spalle': 'Spalle',
      'Deltoidi': 'Spalle',
      'Addominali': 'Core',
      'Obliqui': 'Core',
      'Quadricipiti': 'Gambe',
      'Bicipiti femorali': 'Gambe',
      'Glutei': 'Gambe',
      'Polpacci': 'Gambe',
    };
    for (final entry in map.entries) {
      if (muscle.toLowerCase().contains(entry.key.toLowerCase())) {
        return entry.value;
      }
    }
    return 'Altro';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'muscle': muscle,
        'eq': eq,
        'media': media,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is Esercizio && other.id == id);

  @override
  int get hashCode => id.hashCode;
}
