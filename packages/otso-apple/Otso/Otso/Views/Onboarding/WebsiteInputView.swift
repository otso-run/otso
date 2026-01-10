//
//  WebsiteInputView.swift
//  Otso
//
//  Website URL input for IndieAuth
//

import SwiftUI
#if os(iOS)
import UIKit
#endif

struct WebsiteInputView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var websiteURL = ""
    @State private var isValidating = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        NavigationStack {
            VStack {

                VStack(spacing: 24) {
                    // Header illustration
                    Image(systemName: "globe.badge.chevron.backward")
                        .font(.system(size: 48, weight: .semibold))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.tint)
                        .padding(.top, 32)

                    // Instructions
                    VStack(spacing: 12) {
                        Text("Enter your website")
                            .font(.title2)
                            .fontWeight(.bold)

                        Text("We'll use IndieAuth to sign you in securely")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // URL input field
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Website URL")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)

                        HStack(spacing: 12) {
                            Image(systemName: "link")
                                .font(.body)
                                .foregroundStyle(.tertiary)

                            TextField("https://example.com", text: $websiteURL)
                                #if os(iOS)
                                .keyboardType(.URL)
                                .textContentType(.URL)
                                .autocapitalization(.none)
                                #endif
                                .disableAutocorrection(true)
                                .focused($isTextFieldFocused)
                                .textFieldStyle(.plain)
                        }
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(
                                    isTextFieldFocused
                                        ? Color.accentColor.opacity(0.5)
                                        : Color.clear,
                                    lineWidth: 1
                                )
                        )
                    }
                    .padding(.horizontal)

                    // Example websites
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Examples:")
                            .font(.caption)
                            .foregroundStyle(.tertiary)

                        HStack(spacing: 8) {
                            ExampleChip(text: "micro.blog") {
                                websiteURL = "https://micro.blog"
                            }

                            ExampleChip(text: "wordpress.com") {
                                websiteURL = "https://wordpress.com"
                            }

                            ExampleChip(text: "withknown.com") {
                                websiteURL = "https://withknown.com"
                            }
                        }
                    }
                    .padding(.horizontal)

                    Spacer()

                    // Continue button
                    Button {
                        validateAndContinue()
                    } label: {
                        if isValidating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                        } else {
                            Text("Continue")
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(websiteURL.isEmpty || isValidating)
                    .padding(.horizontal)
                    .padding(.bottom)
                }
            }
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Invalid Website", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
            .onAppear {
                isTextFieldFocused = true
            }
        }
    }

    private func validateAndContinue() {
        isValidating = true

        // Mock validation
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            isValidating = false

            if websiteURL.isEmpty || !websiteURL.contains(".") {
                errorMessage = "Please enter a valid website URL"
                showingError = true
            } else {
                // Would normally proceed to IndieAuth flow
                dismiss()
            }
        }
    }
}

private struct ExampleChip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.caption)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

#Preview {
    WebsiteInputView()
}