// Vitest currently discovers repository tests under utils/, worker/, and scripts/.
// Keep the host prototype itself isolated under extensions/ and import its
// conformance suite here without widening the production/test configuration.
import '../extensions/xiafork/local-tts-host/adapters.test';
