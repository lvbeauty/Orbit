/// Base URL of the Nonstop backend (see ../../backend). Override at build/run time with
/// `--dart-define=BACKEND_URL=https://your-tunnel-url` when testing on a device, since
/// "localhost" from a phone/simulator won't reach a server running on your laptop.
const String backendBaseUrl = String.fromEnvironment(
  'BACKEND_URL',
  defaultValue: 'http://localhost:8080',
);
