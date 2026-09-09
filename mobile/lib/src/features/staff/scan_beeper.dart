/// The sound the counter runs on.
///
/// DESIGN.md requires staff feedback readable from a metre with colour **and**
/// sound. Sound is not decoration here: during a rush the person scanning is
/// looking at the student and the queue, not at the tablet. The tone is often
/// the only signal they actually receive.
///
/// Tones are synthesised rather than shipped as assets — the same approach the
/// web takes with WebAudio. Three short PCM buffers cost nothing, avoid asset
/// plumbing, and keep the pitches in one readable place instead of inside
/// binary files nobody can inspect.
///
///   - **success** — a rising two-note chirp. Rising reads as "go" without
///     anyone being taught it.
///   - **danger** — low and long. Distinct at a glance-free distance from the
///     success tone, which is the entire point.
///   - **warning** — mid, short. Neither, because "already served" is neither.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

import '../../design/status_badge.dart';

const int _sampleRate = 44100;

/// A 16-bit mono WAV of one or more tones played in sequence.
Uint8List _wav(List<({double hz, int ms})> notes) {
  final samples = <int>[];

  for (final note in notes) {
    final count = _sampleRate * note.ms ~/ 1000;
    for (var i = 0; i < count; i++) {
      // Taper both ends. A square-edged buffer clicks audibly, and at a counter
      // a click is indistinguishable from the beep it precedes.
      final fade = math.min(1.0, math.min(i, count - i) / (_sampleRate * 0.005));
      final value =
          math.sin(2 * math.pi * note.hz * i / _sampleRate) * 0.35 * fade;
      samples.add((value * 32767).round().clamp(-32768, 32767));
    }
  }

  final data = ByteData(samples.length * 2);
  for (var i = 0; i < samples.length; i++) {
    data.setInt16(i * 2, samples[i], Endian.little);
  }

  final body = data.buffer.asUint8List();
  final header = ByteData(44);
  void ascii(int at, String s) {
    for (var i = 0; i < s.length; i++) {
      header.setUint8(at + i, s.codeUnitAt(i));
    }
  }

  ascii(0, 'RIFF');
  header.setUint32(4, 36 + body.length, Endian.little);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, Endian.little); // PCM chunk size
  header.setUint16(20, 1, Endian.little); // PCM
  header.setUint16(22, 1, Endian.little); // mono
  header.setUint32(24, _sampleRate, Endian.little);
  header.setUint32(28, _sampleRate * 2, Endian.little); // byte rate
  header.setUint16(32, 2, Endian.little); // block align
  header.setUint16(34, 16, Endian.little); // bits per sample
  ascii(36, 'data');
  header.setUint32(40, body.length, Endian.little);

  return Uint8List.fromList([...header.buffer.asUint8List(), ...body]);
}

class ScanBeeper {
  final _player = AudioPlayer();

  late final Uint8List _success = _wav([
    (hz: 880, ms: 90),
    (hz: 1320, ms: 120),
  ]);
  late final Uint8List _danger = _wav([(hz: 220, ms: 450)]);
  late final Uint8List _warning = _wav([(hz: 520, ms: 200)]);

  Future<void> play(StatusTone tone) async {
    final bytes = switch (tone) {
      StatusTone.active => _success,
      StatusTone.danger => _danger,
      _ => _warning,
    };
    try {
      await _player.play(BytesSource(bytes), volume: 1);
    } catch (_) {
      // A silent tablet still serves meals. Never let audio stop a scan.
    }
  }

  Future<void> dispose() => _player.dispose();
}
