import 'package:shared_preferences/shared_preferences.dart';

/// "Auth" minimale: nome utente salvato localmente.
///
/// Stessa logica del vecchio `localStorage.getItem('mioNome')`.
/// Quando integreremo Firebase Auth vero (Google/Apple/email) basterà
/// sostituire questa implementazione.
class AuthService {
  static const _kNome = 'mioNome';

  Future<String?> currentNome() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kNome);
  }

  Future<void> setNome(String nome) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kNome, nome);
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kNome);
  }
}
