package com.waytosuccess.attendance;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class SecureMainActivity extends Activity implements NfcAdapter.ReaderCallback {
    private static final String API_URL =
        "https://wuftzyeajmsxdrbwaawl.supabase.co/functions/v1/attendance-scan";
    private static final String PREFS = "wts_attendance_scanner";
    private static final String KEY_DEVICE_CODE = "device_code";
    private static final String KEY_DEVICE_SECRET = "device_secret";
    private static final String KEY_INSTALLATION_ID = "installation_id";
    private static final int LOCATION_PERMISSION_REQUEST = 4201;
    private static final long MAX_LOCATION_AGE_MS = 120_000L;

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SharedPreferences preferences;
    private NfcAdapter nfcAdapter;
    private GmsBarcodeScanner codeScanner;
    private ToneGenerator toneGenerator;
    private TextView deviceStatus;
    private TextView locationStatus;
    private TextView nfcStatus;
    private TextView resultTitle;
    private TextView resultName;
    private TextView resultMeta;
    private TextView resultTime;
    private LinearLayout resultCard;
    private Button checkInButton;
    private Button checkOutButton;
    private Button qrButton;
    private volatile String attendanceMode = "check_in";
    private volatile boolean processing = false;
    private PendingScan pendingScan;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        ensureInstallationId();
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        toneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);

        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build();
        codeScanner = GmsBarcodeScanning.getClient(this, options);

        setContentView(buildInterface());
        refreshDeviceStatus();
        refreshLocationStatus();
        refreshNfcStatus();
        setMode("check_in");
        if (!hasDeviceConfiguration()) deviceStatus.post(this::showDeviceSetupDialog);
    }

    private View buildInterface() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(240, 247, 244));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(30));
        scroll.addView(root);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackground(rounded(Color.rgb(26, 42, 74), 14));
        TextView school = label("WAY TO SUCCESS STANDARD SCHOOLS", 21, Color.WHITE, true);
        school.setGravity(Gravity.CENTER);
        school.setPadding(dp(12), dp(18), dp(12), dp(6));
        TextView title = label("Secure Gate Attendance Scanner", 14, Color.rgb(168, 230, 204), true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(dp(12), 0, dp(12), dp(18));
        header.addView(school);
        header.addView(title);
        root.addView(header, fullWidth(0, 0, 0, 14));

        LinearLayout deviceCard = cardContainer();
        deviceCard.addView(label("AUTHORIZED INSTALLATION", 12, Color.rgb(74, 85, 104), true));
        deviceStatus = label("Not configured", 14, Color.rgb(26, 42, 74), true);
        deviceCard.addView(deviceStatus, fullWidth(0, 7, 0, 10));
        Button configure = actionButton("Configure School Device", Color.rgb(26, 42, 74), Color.WHITE);
        configure.setOnClickListener(v -> showDeviceSetupDialog());
        deviceCard.addView(configure);
        root.addView(deviceCard, fullWidth(0, 0, 0, 14));

        LinearLayout securityCard = cardContainer();
        securityCard.addView(label("GATE LOCATION SECURITY", 12, Color.rgb(74, 85, 104), true));
        locationStatus = label("Checking location permission…", 13, Color.rgb(74, 85, 104), true);
        securityCard.addView(locationStatus, fullWidth(0, 7, 0, 9));
        Button locationButton = actionButton("Enable Gate Location", Color.rgb(15, 124, 92), Color.WHITE);
        locationButton.setOnClickListener(v -> requestLocationPermission());
        securityCard.addView(locationButton);
        root.addView(securityCard, fullWidth(0, 0, 0, 14));

        LinearLayout modeCard = cardContainer();
        modeCard.addView(label("ATTENDANCE MODE", 12, Color.rgb(74, 85, 104), true));
        LinearLayout modeRow = new LinearLayout(this);
        modeRow.setOrientation(LinearLayout.HORIZONTAL);
        checkInButton = actionButton("Check-in", Color.rgb(26, 42, 74), Color.WHITE);
        checkOutButton = actionButton("Checkout", Color.WHITE, Color.rgb(26, 42, 74));
        checkInButton.setOnClickListener(v -> setMode("check_in"));
        checkOutButton.setOnClickListener(v -> setMode("check_out"));
        modeRow.addView(checkInButton, weighted(1, 5, 8, 0, 0));
        modeRow.addView(checkOutButton, weighted(1, 5, 0, 8, 0));
        modeCard.addView(modeRow, fullWidth(0, 10, 0, 0));
        root.addView(modeCard, fullWidth(0, 0, 0, 14));

        LinearLayout scanCard = cardContainer();
        scanCard.addView(label("PRESENT STUDENT OR STAFF CREDENTIAL", 12, Color.rgb(74, 85, 104), true));
        qrButton = actionButton("Scan QR Code", Color.rgb(125, 212, 176), Color.rgb(26, 42, 74));
        qrButton.setTextSize(17);
        qrButton.setPadding(dp(12), dp(16), dp(12), dp(16));
        qrButton.setOnClickListener(v -> startQrScan());
        scanCard.addView(qrButton, fullWidth(0, 10, 0, 10));
        nfcStatus = label("Checking NFC…", 13, Color.rgb(74, 85, 104), true);
        nfcStatus.setGravity(Gravity.CENTER);
        nfcStatus.setPadding(dp(10), dp(14), dp(10), dp(14));
        nfcStatus.setBackground(rounded(Color.rgb(240, 247, 244), 10));
        scanCard.addView(nfcStatus);
        root.addView(scanCard, fullWidth(0, 0, 0, 14));

        resultCard = cardContainer();
        resultTitle = label("READY", 17, Color.rgb(26, 42, 74), true);
        resultTitle.setGravity(Gravity.CENTER);
        resultName = label("Waiting for a credential", 20, Color.rgb(26, 42, 74), true);
        resultName.setGravity(Gravity.CENTER);
        resultMeta = label("", 14, Color.rgb(74, 85, 104), true);
        resultMeta.setGravity(Gravity.CENTER);
        resultTime = label("", 12, Color.rgb(74, 85, 104), false);
        resultTime.setGravity(Gravity.CENTER);
        resultCard.addView(resultTitle);
        resultCard.addView(resultName, fullWidth(0, 12, 0, 7));
        resultCard.addView(resultMeta);
        resultCard.addView(resultTime, fullWidth(0, 6, 0, 0));
        root.addView(resultCard);
        return scroll;
    }

    private void startQrScan() {
        if (!hasDeviceConfiguration()) {
            showDeviceSetupDialog();
            return;
        }
        if (processing) return;
        codeScanner.startScan()
            .addOnSuccessListener(barcode -> submitCredential(barcode.getRawValue(), "qr"))
            .addOnCanceledListener(() -> Toast.makeText(this, "QR scan cancelled", Toast.LENGTH_SHORT).show())
            .addOnFailureListener(error -> showFailure("Unable to open QR scanner: " + safeMessage(error), "SCANNER ERROR"));
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        String credential = readNdefCredential(tag);
        if (credential == null || credential.trim().isEmpty()) {
            runOnUiThread(() -> showFailure("This NFC card is not enrolled.", "UNKNOWN NFC CARD"));
            return;
        }
        submitCredential(credential, "nfc");
    }

    private void submitCredential(String rawCredential, String source) {
        String credential = rawCredential == null ? "" : rawCredential.trim();
        if (credential.length() < 16) {
            showFailure("The credential is invalid.", "INVALID CREDENTIAL");
            return;
        }
        if (!hasDeviceConfiguration()) {
            showDeviceSetupDialog();
            return;
        }
        if (processing) return;

        processing = true;
        qrButton.setEnabled(false);
        resultCard.setBackground(rounded(Color.rgb(255, 248, 225), 12));
        resultTitle.setText("VERIFYING LOCATION…");
        resultName.setText("Securing attendance scan");
        resultMeta.setText("");
        resultTime.setText("");
        pendingScan = new PendingScan(
            credential,
            source,
            UUID.randomUUID().toString(),
            attendanceMode,
            currentIsoTimestamp()
        );
        ensureLocationAndSend();
    }

    private void ensureLocationAndSend() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }, LOCATION_PERMISSION_REQUEST);
            return;
        }
        captureLocation();
    }

    private void captureLocation() {
        LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            failPending("Location service is unavailable.", "LOCATION REQUIRED");
            return;
        }

        String provider = null;
        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) provider = LocationManager.GPS_PROVIDER;
        else if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) provider = LocationManager.NETWORK_PROVIDER;
        if (provider == null) {
            failPending("Switch on phone location before scanning.", "LOCATION REQUIRED");
            return;
        }

        try {
            Location last = manager.getLastKnownLocation(provider);
            if (last != null && System.currentTimeMillis() - last.getTime() <= MAX_LOCATION_AGE_MS) {
                sendPending(last);
                return;
            }

            AtomicBoolean completed = new AtomicBoolean(false);
            String finalProvider = provider;
            LocationListener listener = new LocationListener() {
                @Override public void onLocationChanged(Location location) {
                    if (!completed.compareAndSet(false, true)) return;
                    manager.removeUpdates(this);
                    sendPending(location);
                }
                @Override public void onProviderDisabled(String name) { }
                @Override public void onProviderEnabled(String name) { }
                @Override public void onStatusChanged(String providerName, int status, Bundle extras) { }
            };
            manager.requestSingleUpdate(finalProvider, listener, Looper.getMainLooper());
            mainHandler.postDelayed(() -> {
                if (!completed.compareAndSet(false, true)) return;
                manager.removeUpdates(listener);
                failPending("Unable to confirm the school gate location. Retry outdoors.", "LOCATION TIMEOUT");
            }, 12_000L);
        } catch (SecurityException error) {
            failPending("Location permission is required for secure scanning.", "LOCATION REQUIRED");
        }
    }

    private void sendPending(Location location) {
        PendingScan scan = pendingScan;
        if (scan == null) return;
        networkExecutor.execute(() -> callAttendanceApi(scan, location));
    }

    private void callAttendanceApi(PendingScan scan, Location location) {
        HttpURLConnection connection = null;
        try {
            JSONObject bodyJson = new JSONObject();
            bodyJson.put("credential", scan.credential);
            bodyJson.put("clientEventId", scan.eventId);
            bodyJson.put("eventType", scan.mode);
            bodyJson.put("source", scan.source);
            bodyJson.put("localRecordedAt", scan.localRecordedAt);
            bodyJson.put("latitude", location.getLatitude());
            bodyJson.put("longitude", location.getLongitude());
            bodyJson.put("locationAccuracyMetres", location.getAccuracy());
            bodyJson.put("locationCapturedAt", isoTimestamp(location.getTime()));

            byte[] body = bodyJson.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(API_URL).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(15_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("x-wts-device-code", preferences.getString(KEY_DEVICE_CODE, ""));
            connection.setRequestProperty("x-wts-device-secret", preferences.getString(KEY_DEVICE_SECRET, ""));
            connection.setRequestProperty("x-wts-installation-id", preferences.getString(KEY_INSTALLATION_ID, ""));
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSONObject response = new JSONObject(readStream(stream));
            runOnUiThread(() -> renderResponse(response));
        } catch (Exception error) {
            runOnUiThread(() -> showFailure("Could not reach the attendance server.", "NETWORK ERROR"));
        } finally {
            if (connection != null) connection.disconnect();
            runOnUiThread(this::finishProcessing);
        }
    }

    private void renderResponse(JSONObject response) {
        if (!response.optBoolean("ok", false)) {
            String code = response.optString("code", "UNKNOWN_RESPONSE");
            String message;
            switch (code) {
                case "DEVICE_OUTSIDE_SCHOOL_GEOFENCE":
                    message = "This scanner is outside the approved school gate area."; break;
                case "DEVICE_LOCATION_REQUIRED":
                    message = "A verified gate location is required."; break;
                case "DEVICE_INSTALLATION_MISMATCH":
                    message = "This device configuration was copied to another phone."; break;
                case "INSTALLATION_ID_REQUIRED":
                    message = "This scanner installation has not been registered."; break;
                case "DEVICE_PERSON_SCOPE_DENIED":
                    message = "This device is not permitted for this person type."; break;
                case "NO_SCHOOL_TODAY":
                case "NO_STAFF_WORK_TODAY":
                    message = "Attendance is closed for today."; break;
                case "UNKNOWN_OR_INACTIVE_CREDENTIAL":
                case "UNKNOWN_OR_INACTIVE_STAFF_CREDENTIAL":
                    message = "Credential is unknown, suspended or replaced."; break;
                case "NO_CHECK_IN_FOR_TODAY":
                    message = "Checkout cannot be recorded before check-in."; break;
                default:
                    message = "Attendance was not recorded (" + code + ").";
            }
            showFailure(message, "NOT RECORDED");
            return;
        }

        String personType = response.optString("person_type", "student");
        JSONObject person = "staff".equals(personType)
            ? response.optJSONObject("staff")
            : response.optJSONObject("student");
        JSONObject event = response.optJSONObject("event");
        String name = person == null ? "Attendance holder" : person.optString("name", "Attendance holder");
        String meta = "staff".equals(personType)
            ? person.optString("designation", person.optString("category", "Staff"))
            : formatClassKey(person == null ? "" : person.optString("class_key", ""));
        String status = event == null ? "" : event.optString("attendance_status", "");
        int late = event == null ? 0 : event.optInt("late_minutes", 0);
        int excess = event == null ? 0 : event.optInt("departure_excess_minutes", 0);
        int total = event == null ? 0 : event.optInt("total_minutes_on_premises", event.optInt("worked_minutes", 0));
        boolean duplicate = response.optBoolean("duplicate", false);

        resultCard.setBackground(rounded(duplicate ? Color.rgb(227, 242, 253) : Color.rgb(232, 245, 233), 12));
        if (duplicate) resultTitle.setText("ALREADY RECORDED");
        else if ("check_out".equals(attendanceMode)) resultTitle.setText("CHECKOUT RECORDED");
        else if (late > 0) resultTitle.setText("LATE ARRIVAL");
        else resultTitle.setText(personType.toUpperCase(Locale.US) + " CHECK-IN RECORDED");
        resultName.setText(name);

        StringBuilder details = new StringBuilder(meta);
        if (late > 0) details.append(" • ").append(late).append(" minutes late");
        if ("check_out".equals(attendanceMode)) {
            details.append(" • ").append(total / 60).append("h ").append(total % 60).append("m total");
            if (excess > 0) details.append(" • ").append(excess).append(" min after 3:30");
        } else if (!status.isEmpty()) {
            details.append(" • ").append(status.replace('_', ' ').toUpperCase(Locale.US));
        }
        resultMeta.setText(details.toString());
        resultTime.setText(formatServerTime(event == null ? "" : event.optString("event_time", "")));
        playSuccessFeedback();
    }

    private void setMode(String mode) {
        attendanceMode = mode;
        boolean checkIn = "check_in".equals(mode);
        styleModeButton(checkInButton, checkIn);
        styleModeButton(checkOutButton, !checkIn);
        resultTitle.setText(checkIn ? "CHECK-IN READY" : "CHECKOUT READY");
        resultName.setText("Waiting for a credential");
        resultMeta.setText("");
        resultTime.setText("");
        resultCard.setBackground(rounded(Color.WHITE, 12));
    }

    private void requestLocationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            refreshLocationStatus();
            Toast.makeText(this, "Gate location permission is enabled", Toast.LENGTH_SHORT).show();
            return;
        }
        requestPermissions(new String[]{
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        }, LOCATION_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST) return;
        refreshLocationStatus();
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            if (pendingScan != null) captureLocation();
        } else if (pendingScan != null) {
            failPending("Location permission is required for secure gate scanning.", "LOCATION DENIED");
        }
    }

    private void showDeviceSetupDialog() {
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(20), dp(6), dp(20), 0);
        EditText codeInput = new EditText(this);
        codeInput.setHint("Device code");
        codeInput.setSingleLine(true);
        codeInput.setText(preferences.getString(KEY_DEVICE_CODE, ""));
        EditText secretInput = new EditText(this);
        secretInput.setHint(preferences.getString(KEY_DEVICE_SECRET, "").isEmpty()
            ? "One-time device secret" : "Leave blank to keep saved secret");
        secretInput.setSingleLine(true);
        secretInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        container.addView(codeInput);
        container.addView(secretInput);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Configure School Scanner")
            .setMessage("Only management should enter credentials issued to this school-owned installation.")
            .setView(container)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", null)
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String code = codeInput.getText().toString().trim();
            String entered = secretInput.getText().toString().trim();
            String secret = entered.isEmpty() ? preferences.getString(KEY_DEVICE_SECRET, "") : entered;
            if (code.isEmpty() || secret.isEmpty()) {
                Toast.makeText(this, "Device code and secret are required", Toast.LENGTH_SHORT).show();
                return;
            }
            preferences.edit().putString(KEY_DEVICE_CODE, code).putString(KEY_DEVICE_SECRET, secret).apply();
            refreshDeviceStatus();
            dialog.dismiss();
        }));
        dialog.show();
    }

    private void ensureInstallationId() {
        if (!preferences.getString(KEY_INSTALLATION_ID, "").isEmpty()) return;
        preferences.edit().putString(KEY_INSTALLATION_ID, UUID.randomUUID().toString()).apply();
    }

    private boolean hasDeviceConfiguration() {
        return !preferences.getString(KEY_DEVICE_CODE, "").isEmpty()
            && !preferences.getString(KEY_DEVICE_SECRET, "").isEmpty();
    }

    private void refreshDeviceStatus() {
        String code = preferences.getString(KEY_DEVICE_CODE, "");
        if (code.isEmpty()) {
            deviceStatus.setText("Not configured — scanning is disabled");
            deviceStatus.setTextColor(Color.rgb(185, 28, 28));
        } else {
            deviceStatus.setText("Configured as " + code + " • installation locked on first secure scan");
            deviceStatus.setTextColor(Color.rgb(6, 95, 70));
        }
    }

    private void refreshLocationStatus() {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        locationStatus.setText(granted
            ? "LOCATION READY — every production scan will be checked against the school gate"
            : "Location permission required before production scanning");
        locationStatus.setTextColor(granted ? Color.rgb(6, 95, 70) : Color.rgb(185, 28, 28));
    }

    private void refreshNfcStatus() {
        if (nfcAdapter == null) {
            nfcStatus.setText("NFC unavailable — QR remains available");
            nfcStatus.setTextColor(Color.rgb(146, 64, 14));
        } else if (!nfcAdapter.isEnabled()) {
            nfcStatus.setText("NFC is switched off");
            nfcStatus.setTextColor(Color.rgb(185, 28, 28));
        } else {
            nfcStatus.setText("NFC READY — tap an enrolled card");
            nfcStatus.setTextColor(Color.rgb(6, 95, 70));
        }
    }

    private String readNdefCredential(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return null;
        try {
            NdefMessage message = ndef.getCachedNdefMessage();
            if (message == null) {
                ndef.connect();
                message = ndef.getNdefMessage();
                ndef.close();
            }
            if (message == null) return null;
            for (NdefRecord record : message.getRecords()) {
                if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN &&
                    Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                    byte[] payload = record.getPayload();
                    int languageLength = payload[0] & 0x3F;
                    return new String(payload, 1 + languageLength,
                        payload.length - 1 - languageLength, StandardCharsets.UTF_8).trim();
                }
            }
        } catch (Exception ignored) { return null; }
        return null;
    }

    private void failPending(String message, String heading) {
        runOnUiThread(() -> {
            showFailure(message, heading);
            finishProcessing();
        });
    }

    private void finishProcessing() {
        processing = false;
        pendingScan = null;
        qrButton.setEnabled(true);
    }

    private void showFailure(String message, String heading) {
        resultCard.setBackground(rounded(Color.rgb(255, 235, 238), 12));
        resultTitle.setText(heading);
        resultName.setText(message);
        resultMeta.setText("");
        resultTime.setText("");
        playErrorFeedback();
    }

    private void playSuccessFeedback() {
        toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP, 130);
        vibrate(100);
    }

    private void playErrorFeedback() {
        toneGenerator.startTone(ToneGenerator.TONE_SUP_ERROR, 250);
        vibrate(250);
    }

    private void vibrate(long milliseconds) {
        Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(milliseconds);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshLocationStatus();
        refreshNfcStatus();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B |
                NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V;
            nfcAdapter.enableReaderMode(this, this, flags, null);
        }
    }

    @Override
    protected void onPause() {
        if (nfcAdapter != null) nfcAdapter.disableReaderMode(this);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        if (toneGenerator != null) toneGenerator.release();
        super.onDestroy();
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(null, android.graphics.Typeface.BOLD);
        return view;
    }

    private Button actionButton(String text, int background, int foreground) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(foreground);
        button.setBackground(rounded(background, 9));
        return button;
    }

    private LinearLayout cardContainer() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(rounded(Color.WHITE, 12));
        return card;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private LinearLayout.LayoutParams fullWidth(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private LinearLayout.LayoutParams weighted(float weight, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private void styleModeButton(Button button, boolean selected) {
        button.setTextColor(selected ? Color.WHITE : Color.rgb(26, 42, 74));
        button.setBackground(rounded(selected ? Color.rgb(26, 42, 74) : Color.rgb(240, 247, 244), 9));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }

    private String currentIsoTimestamp() {
        return isoTimestamp(System.currentTimeMillis());
    }

    private String isoTimestamp(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);
        format.setTimeZone(TimeZone.getDefault());
        return format.format(new Date(time));
    }

    private String formatServerTime(String value) {
        if (value == null || value.isEmpty()) return "";
        return value.replace('T', ' ').replace('Z', ' ').trim();
    }

    private String formatClassKey(String value) {
        return value == null ? "" : value.replace('-', ' ').toUpperCase(Locale.US);
    }

    private String safeMessage(Exception error) {
        return error == null || error.getMessage() == null ? "Unknown error" : error.getMessage();
    }

    private static final class PendingScan {
        final String credential;
        final String source;
        final String eventId;
        final String mode;
        final String localRecordedAt;

        PendingScan(String credential, String source, String eventId, String mode, String localRecordedAt) {
            this.credential = credential;
            this.source = source;
            this.eventId = eventId;
            this.mode = mode;
            this.localRecordedAt = localRecordedAt;
        }
    }
}
