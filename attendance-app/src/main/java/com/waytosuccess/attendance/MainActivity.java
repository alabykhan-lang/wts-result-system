package com.waytosuccess.attendance;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.os.Bundle;
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

import com.google.android.gms.mlkit.codescanner.GmsBarcodeScanner;
import com.google.android.gms.mlkit.codescanner.GmsBarcodeScannerOptions;
import com.google.android.gms.mlkit.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;

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

public final class MainActivity extends Activity implements NfcAdapter.ReaderCallback {
    private static final String API_URL =
        "https://wuftzyeajmsxdrbwaawl.supabase.co/functions/v1/attendance-scan";
    private static final String PREFS = "wts_attendance_scanner";
    private static final String KEY_DEVICE_CODE = "device_code";
    private static final String KEY_DEVICE_SECRET = "device_secret";

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private NfcAdapter nfcAdapter;
    private GmsBarcodeScanner codeScanner;
    private ToneGenerator toneGenerator;

    private TextView deviceStatus;
    private TextView nfcStatus;
    private TextView resultTitle;
    private TextView resultName;
    private TextView resultMeta;
    private TextView resultTime;
    private LinearLayout resultCard;
    private Button checkInButton;
    private Button checkOutButton;
    private Button qrButton;
    private EditText developerTokenInput;

    private volatile String attendanceMode = "check_in";
    private volatile boolean processing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        toneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);

        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build();
        codeScanner = GmsBarcodeScanning.getClient(this, options);

        setContentView(buildInterface());
        refreshDeviceStatus();
        refreshNfcStatus();
        setMode("check_in");

        if (!hasDeviceConfiguration()) {
            deviceStatus.post(this::showDeviceSetupDialog);
        }
    }

    private View buildInterface() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(Color.rgb(240, 247, 244));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(30));
        scrollView.addView(root, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));

        TextView schoolName = label("WAY TO SUCCESS STANDARD SCHOOLS", 21, Color.WHITE, true);
        schoolName.setGravity(Gravity.CENTER);
        schoolName.setPadding(dp(14), dp(18), dp(14), dp(6));

        TextView screenName = label("Digital Attendance Scanner", 14, Color.rgb(168, 230, 204), true);
        screenName.setGravity(Gravity.CENTER);
        screenName.setPadding(dp(14), 0, dp(14), dp(18));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackground(rounded(Color.rgb(26, 42, 74), 14));
        header.addView(schoolName);
        header.addView(screenName);
        root.addView(header, fullWidth(0, 0, 0, 14));

        LinearLayout deviceCard = cardContainer();
        TextView deviceHeading = label("SCANNER DEVICE", 12, Color.rgb(74, 85, 104), true);
        deviceStatus = label("Not configured", 14, Color.rgb(26, 42, 74), true);
        Button configureButton = actionButton("Configure Device", Color.rgb(26, 42, 74), Color.WHITE);
        configureButton.setOnClickListener(view -> showDeviceSetupDialog());
        deviceCard.addView(deviceHeading);
        deviceCard.addView(deviceStatus, fullWidth(0, 7, 0, 10));
        deviceCard.addView(configureButton, fullWidth(0, 0, 0, 0));
        root.addView(deviceCard, fullWidth(0, 0, 0, 14));

        LinearLayout modeCard = cardContainer();
        modeCard.addView(label("ATTENDANCE MODE", 12, Color.rgb(74, 85, 104), true));

        LinearLayout modeRow = new LinearLayout(this);
        modeRow.setOrientation(LinearLayout.HORIZONTAL);
        checkInButton = actionButton("Morning Check-in", Color.rgb(26, 42, 74), Color.WHITE);
        checkOutButton = actionButton("Student Checkout", Color.WHITE, Color.rgb(26, 42, 74));
        checkInButton.setOnClickListener(view -> setMode("check_in"));
        checkOutButton.setOnClickListener(view -> setMode("check_out"));
        modeRow.addView(checkInButton, weighted(1, 5, 8, 0, 0));
        modeRow.addView(checkOutButton, weighted(1, 5, 0, 8, 0));
        modeCard.addView(modeRow, fullWidth(0, 10, 0, 0));
        root.addView(modeCard, fullWidth(0, 0, 0, 14));

        LinearLayout scanCard = cardContainer();
        scanCard.addView(label("PRESENT CREDENTIAL", 12, Color.rgb(74, 85, 104), true));

        qrButton = actionButton("Scan Student QR Code", Color.rgb(125, 212, 176), Color.rgb(26, 42, 74));
        qrButton.setTextSize(17);
        qrButton.setPadding(dp(12), dp(16), dp(12), dp(16));
        qrButton.setOnClickListener(view -> startQrScan());
        scanCard.addView(qrButton, fullWidth(0, 10, 0, 10));

        nfcStatus = label("Checking NFC…", 14, Color.rgb(74, 85, 104), true);
        nfcStatus.setGravity(Gravity.CENTER);
        nfcStatus.setPadding(dp(10), dp(15), dp(10), dp(15));
        nfcStatus.setBackground(rounded(Color.rgb(240, 247, 244), 10));
        scanCard.addView(nfcStatus, fullWidth(0, 0, 0, 10));

        TextView instruction = label(
            "For NFC: keep this screen open and place the student card against the back of the phone.",
            12,
            Color.rgb(74, 85, 104),
            false
        );
        instruction.setGravity(Gravity.CENTER);
        scanCard.addView(instruction);
        root.addView(scanCard, fullWidth(0, 0, 0, 14));

        resultCard = cardContainer();
        resultTitle = label("READY", 17, Color.rgb(26, 42, 74), true);
        resultTitle.setGravity(Gravity.CENTER);
        resultName = label("Waiting for a QR code or NFC card", 20, Color.rgb(26, 42, 74), true);
        resultName.setGravity(Gravity.CENTER);
        resultMeta = label("", 14, Color.rgb(74, 85, 104), true);
        resultMeta.setGravity(Gravity.CENTER);
        resultTime = label("", 12, Color.rgb(74, 85, 104), false);
        resultTime.setGravity(Gravity.CENTER);
        resultCard.addView(resultTitle);
        resultCard.addView(resultName, fullWidth(0, 12, 0, 7));
        resultCard.addView(resultMeta);
        resultCard.addView(resultTime, fullWidth(0, 6, 0, 0));
        root.addView(resultCard, fullWidth(0, 0, 0, 14));

        LinearLayout developerCard = cardContainer();
        developerCard.addView(label("PRIVATE DEVELOPMENT TEST", 12, Color.rgb(74, 85, 104), true));
        developerTokenInput = new EditText(this);
        developerTokenInput.setHint("Paste a generated test credential");
        developerTokenInput.setSingleLine(true);
        developerTokenInput.setTextSize(13);
        developerTokenInput.setPadding(dp(12), dp(12), dp(12), dp(12));
        developerTokenInput.setBackground(rounded(Color.rgb(245, 247, 250), 8));
        developerCard.addView(developerTokenInput, fullWidth(0, 9, 0, 8));
        Button simulateButton = actionButton("Submit Test Credential", Color.rgb(74, 85, 104), Color.WHITE);
        simulateButton.setOnClickListener(view -> submitCredential(
            developerTokenInput.getText().toString(),
            "qr"
        ));
        developerCard.addView(simulateButton);
        root.addView(developerCard, fullWidth(0, 0, 0, 0));

        return scrollView;
    }

    private void setMode(String mode) {
        attendanceMode = mode;
        boolean checkIn = "check_in".equals(mode);
        styleModeButton(checkInButton, checkIn);
        styleModeButton(checkOutButton, !checkIn);
        resultTitle.setText(checkIn ? "MORNING CHECK-IN READY" : "CHECKOUT READY");
        resultName.setText("Waiting for a QR code or NFC card");
        resultMeta.setText("");
        resultTime.setText("");
        resultCard.setBackground(rounded(Color.WHITE, 12));
    }

    private void styleModeButton(Button button, boolean selected) {
        button.setTextColor(selected ? Color.WHITE : Color.rgb(26, 42, 74));
        button.setBackground(rounded(
            selected ? Color.rgb(26, 42, 74) : Color.rgb(240, 247, 244),
            9
        ));
    }

    private void startQrScan() {
        if (!hasDeviceConfiguration()) {
            showDeviceSetupDialog();
            return;
        }
        if (processing) return;

        codeScanner.startScan()
            .addOnSuccessListener(barcode -> {
                String value = barcode.getRawValue();
                if (value == null || value.trim().isEmpty()) {
                    showFailure("QR code contains no credential", "INVALID QR");
                    return;
                }
                submitCredential(value, "qr");
            })
            .addOnCanceledListener(() -> Toast.makeText(
                this,
                "QR scan cancelled",
                Toast.LENGTH_SHORT
            ).show())
            .addOnFailureListener(error -> showFailure(
                "Unable to open QR scanner: " + safeMessage(error),
                "SCANNER ERROR"
            ));
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        String credential = readNdefCredential(tag);
        if (credential == null || credential.trim().isEmpty()) {
            runOnUiThread(() -> showFailure(
                "This NFC tag has not been enrolled for WTS attendance.",
                "UNKNOWN NFC CARD"
            ));
            return;
        }
        submitCredential(credential, "nfc");
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
                if (
                    record.getTnf() == NdefRecord.TNF_WELL_KNOWN &&
                    Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)
                ) {
                    return parseTextRecord(record.getPayload());
                }

                byte[] payload = record.getPayload();
                if (payload != null && payload.length > 0) {
                    String value = new String(payload, StandardCharsets.UTF_8).trim();
                    if (value.length() >= 16) return value;
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private String parseTextRecord(byte[] payload) {
        if (payload == null || payload.length < 2) return null;
        int languageLength = payload[0] & 0x3F;
        int textStart = 1 + languageLength;
        if (textStart >= payload.length) return null;
        return new String(
            payload,
            textStart,
            payload.length - textStart,
            StandardCharsets.UTF_8
        ).trim();
    }

    private void submitCredential(String rawCredential, String source) {
        String credential = rawCredential == null ? "" : rawCredential.trim();
        if (credential.length() < 16) {
            runOnUiThread(() -> showFailure(
                "The credential is too short or invalid.",
                "INVALID CREDENTIAL"
            ));
            return;
        }
        if (!hasDeviceConfiguration()) {
            runOnUiThread(this::showDeviceSetupDialog);
            return;
        }
        if (processing) {
            runOnUiThread(() -> Toast.makeText(
                this,
                "Please wait for the current scan",
                Toast.LENGTH_SHORT
            ).show());
            return;
        }

        processing = true;
        runOnUiThread(() -> {
            qrButton.setEnabled(false);
            resultCard.setBackground(rounded(Color.rgb(255, 248, 225), 12));
            resultTitle.setText("PROCESSING…");
            resultName.setText("Verifying credential");
            resultMeta.setText("");
            resultTime.setText("");
        });

        String eventId = UUID.randomUUID().toString();
        String localRecordedAt = currentIsoTimestamp();
        String mode = attendanceMode;

        networkExecutor.execute(() -> callAttendanceApi(
            credential,
            eventId,
            mode,
            source,
            localRecordedAt
        ));
    }

    private void callAttendanceApi(
        String credential,
        String eventId,
        String mode,
        String source,
        String localRecordedAt
    ) {
        HttpURLConnection connection = null;
        try {
            JSONObject requestBody = new JSONObject();
            requestBody.put("credential", credential);
            requestBody.put("clientEventId", eventId);
            requestBody.put("eventType", mode);
            requestBody.put("source", source);
            requestBody.put("localRecordedAt", localRecordedAt);

            byte[] body = requestBody.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(API_URL).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(15_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty(
                "x-wts-device-code",
                preferences.getString(KEY_DEVICE_CODE, "")
            );
            connection.setRequestProperty(
                "x-wts-device-secret",
                preferences.getString(KEY_DEVICE_SECRET, "")
            );
            connection.setFixedLengthStreamingMode(body.length);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            String responseText = readStream(stream);
            JSONObject response = new JSONObject(responseText);

            runOnUiThread(() -> renderResponse(response, statusCode));
        } catch (Exception error) {
            runOnUiThread(() -> showFailure(
                "Could not reach the attendance server. Check internet connection and retry.",
                "NETWORK ERROR"
            ));
        } finally {
            if (connection != null) connection.disconnect();
            processing = false;
            runOnUiThread(() -> qrButton.setEnabled(true));
        }
    }

    private void renderResponse(JSONObject response, int statusCode) {
        boolean ok = response.optBoolean("ok", false);
        String code = response.optString("code", "UNKNOWN_RESPONSE");

        if (!ok) {
            String message;
            switch (code) {
                case "NO_SCHOOL_TODAY":
                    message = "Attendance is closed because today is not a configured school day.";
                    break;
                case "UNKNOWN_OR_INACTIVE_CREDENTIAL":
                    message = "Credential is unknown, suspended or replaced.";
                    break;
                case "STUDENT_INACTIVE":
                    message = "The linked student is no longer active.";
                    break;
                case "NO_ATTENDANCE_RULE":
                    message = "No attendance rule covers this student's class.";
                    break;
                case "NO_CHECK_IN_FOR_TODAY":
                    message = "Checkout cannot be recorded before today's check-in.";
                    break;
                case "DEVICE_AUTH_FAILED":
                case "DEVICE_AUTH_REQUIRED":
                    message = "This scanner device is not authorised. Reconfigure the device.";
                    break;
                default:
                    message = "Attendance was not recorded (" + code + ").";
                    break;
            }
            showFailure(message, "NOT RECORDED");
            return;
        }

        JSONObject student = response.optJSONObject("student");
        JSONObject event = response.optJSONObject("event");
        String name = student == null ? "Student" : student.optString("name", "Student");
        String classKey = student == null ? "" : student.optString("class_key", "");
        String attendanceStatus = event == null
            ? ""
            : event.optString("attendance_status", "");
        int lateMinutes = event == null ? 0 : event.optInt("late_minutes", 0);
        String eventTime = event == null ? "" : event.optString("event_time", "");
        boolean duplicate = response.optBoolean("duplicate", false);

        int background;
        String heading;
        if (duplicate) {
            background = Color.rgb(227, 242, 253);
            heading = code.equals("ALREADY_CHECKED_OUT")
                ? "ALREADY CHECKED OUT"
                : "ATTENDANCE ALREADY RECORDED";
            playDuplicateFeedback();
        } else if ("late".equals(attendanceStatus)) {
            background = Color.rgb(255, 243, 224);
            heading = "LATE ARRIVAL";
            playSuccessFeedback();
        } else if ("early".equals(attendanceStatus) && "check_out".equals(attendanceMode)) {
            background = Color.rgb(255, 235, 238);
            heading = "EARLY CHECKOUT RECORDED";
            playSuccessFeedback();
        } else {
            background = Color.rgb(232, 245, 233);
            heading = "ATTENDANCE RECORDED";
            playSuccessFeedback();
        }

        resultCard.setBackground(rounded(background, 12));
        resultTitle.setText(heading);
        resultName.setText(name);

        StringBuilder metadata = new StringBuilder(formatClassKey(classKey));
        if (lateMinutes > 0) {
            metadata.append(" • ").append(lateMinutes).append(" minutes late");
        } else if (!attendanceStatus.isEmpty()) {
            metadata.append(" • ").append(attendanceStatus.replace('_', ' ').toUpperCase(Locale.US));
        }
        resultMeta.setText(metadata.toString());
        resultTime.setText(formatServerTime(eventTime));
        developerTokenInput.setText("");
    }

    private void showFailure(String message, String heading) {
        resultCard.setBackground(rounded(Color.rgb(255, 235, 238), 12));
        resultTitle.setText(heading);
        resultName.setText(message);
        resultMeta.setText("");
        resultTime.setText("");
        playErrorFeedback();
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
        secretInput.setHint(
            preferences.getString(KEY_DEVICE_SECRET, "").isEmpty()
                ? "One-time device secret"
                : "Leave blank to keep saved secret"
        );
        secretInput.setSingleLine(true);
        secretInput.setInputType(
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
        );

        container.addView(codeInput);
        container.addView(secretInput);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Configure Attendance Scanner")
            .setMessage("Enter the private credentials issued to this school-owned phone.")
            .setView(container)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", null)
            .create();

        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            .setOnClickListener(view -> {
                String deviceCode = codeInput.getText().toString().trim();
                String enteredSecret = secretInput.getText().toString().trim();
                String savedSecret = preferences.getString(KEY_DEVICE_SECRET, "");
                String finalSecret = enteredSecret.isEmpty() ? savedSecret : enteredSecret;

                if (deviceCode.isEmpty() || finalSecret.isEmpty()) {
                    Toast.makeText(
                        this,
                        "Device code and secret are required",
                        Toast.LENGTH_SHORT
                    ).show();
                    return;
                }

                preferences.edit()
                    .putString(KEY_DEVICE_CODE, deviceCode)
                    .putString(KEY_DEVICE_SECRET, finalSecret)
                    .apply();
                refreshDeviceStatus();
                dialog.dismiss();
            }));
        dialog.show();
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
            deviceStatus.setText("Configured as " + code);
            deviceStatus.setTextColor(Color.rgb(6, 95, 70));
        }
    }

    private void refreshNfcStatus() {
        if (nfcAdapter == null) {
            nfcStatus.setText("NFC is unavailable on this phone — QR scanning remains available");
            nfcStatus.setTextColor(Color.rgb(146, 64, 14));
        } else if (!nfcAdapter.isEnabled()) {
            nfcStatus.setText("NFC is switched off — enable it in phone settings");
            nfcStatus.setTextColor(Color.rgb(185, 28, 28));
        } else {
            nfcStatus.setText("NFC READY — tap an enrolled card against the phone");
            nfcStatus.setTextColor(Color.rgb(6, 95, 70));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshNfcStatus();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            int flags = NfcAdapter.FLAG_READER_NFC_A
                | NfcAdapter.FLAG_READER_NFC_B
                | NfcAdapter.FLAG_READER_NFC_F
                | NfcAdapter.FLAG_READER_NFC_V;
            nfcAdapter.enableReaderMode(this, this, flags, null);
        }
    }

    @Override
    protected void onPause() {
        if (nfcAdapter != null) {
            nfcAdapter.disableReaderMode(this);
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        if (toneGenerator != null) toneGenerator.release();
        super.onDestroy();
    }

    private void playSuccessFeedback() {
        toneGenerator.startTone(ToneGenerator.TONE_PROP_ACK, 180);
        vibrate(90);
    }

    private void playDuplicateFeedback() {
        toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP2, 180);
        vibrate(60);
    }

    private void playErrorFeedback() {
        toneGenerator.startTone(ToneGenerator.TONE_PROP_NACK, 250);
        vibrate(220);
    }

    private void vibrate(long milliseconds) {
        Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(
                milliseconds,
                VibrationEffect.DEFAULT_AMPLITUDE
            ));
        } else {
            vibrator.vibrate(milliseconds);
        }
    }

    private String currentIsoTimestamp() {
        SimpleDateFormat format = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            Locale.US
        );
        format.setTimeZone(TimeZone.getDefault());
        return format.format(new Date());
    }

    private String formatServerTime(String value) {
        if (value == null || value.isEmpty()) return "";
        return "Server time: " + value.replace('T', ' ');
    }

    private String formatClassKey(String value) {
        if (value == null) return "";
        return value.replace('-', ' ').toUpperCase(Locale.US);
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(stream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName()
            : message;
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.12f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button actionButton(String text, int background, int foreground) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(14);
        button.setTextColor(foreground);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(rounded(background, 9));
        return button;
    }

    private LinearLayout cardContainer() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(rounded(Color.WHITE, 12));
        card.setElevation(dp(2));
        return card;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private LinearLayout.LayoutParams fullWidth(
        int left,
        int top,
        int right,
        int bottom
    ) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private LinearLayout.LayoutParams weighted(
        int weight,
        int left,
        int top,
        int right,
        int bottom
    ) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            weight
        );
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
