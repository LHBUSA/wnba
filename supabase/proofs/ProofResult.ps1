# Client-side parser for the WNBA PBE rollback proof result. Dot-sourced by run-remote-proof.ps1 and by
# test-proof-result-parser.ps1. It only READS the server's error text; it never talks to a database.
#
# The proof's last statement raises `WNBA_PBE_PROOF_RESULT <json array>`. The Supabase Management API returns
# that PostgreSQL error inside a JSON envelope ({"message": "...WNBA_PBE_PROOF_RESULT [...]..."}). The array can
# arrive escaped more than once: the reported failure ("Invalid property identifier character: \. Path '[0]',
# position 2") reproduces only when the message itself still carries \" after the envelope is decoded.
#
# So: decode the envelope with a real JSON parser, match the array in the decoded message, and if the array
# is still escaped, decode it as a JSON string literal (never hand-rolled backslash replacement), up to 3 layers.
# A plain-text message (no envelope) is matched as-is.

function ConvertFrom-WnbaProofArray {
  param([Parameter(Mandatory = $true)][string]$Candidate)
  # Greedy capture ends at the LAST ']' in the message. If trailing server context contains ']', walk back to
  # the longest prefix that parses as a JSON array.
  $c = $Candidate
  while ($true) {
    try {
      $parsed = $c | ConvertFrom-Json -ErrorAction Stop
      if ($parsed -is [string]) { return $null }
      return , @($parsed)
    } catch {
      $cut = $c.LastIndexOf(']', [Math]::Max(0, $c.Length - 2))
      if ($cut -lt 1) { return $null }
      $c = $c.Substring(0, $cut + 1)
    }
  }
}

function ConvertFrom-WnbaProofError {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Raw)

  $message = $Raw
  try {
    $err = $Raw | ConvertFrom-Json -ErrorAction Stop
    if ($err -and $err.PSObject.Properties['message'] -and $err.message) {
      $message = [string]$err.message
    }
  } catch {
    # Not a JSON envelope: some clients already return the PostgreSQL message as plain text.
  }

  $m = [regex]::Match($message, 'WNBA_PBE_PROOF_RESULT (\[.*\])', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $m.Success) { return $null }

  $candidate = $m.Groups[1].Value
  for ($layer = 0; $layer -le 3; $layer++) {
    $results = ConvertFrom-WnbaProofArray -Candidate $candidate
    if ($null -ne $results) {
      return [pscustomobject]@{ Results = $results; Message = $message; EscapeLayers = $layer }
    }
    if ($candidate -notmatch '\\"') { break }
    # Still escaped: decode one layer as a JSON string literal. Trim any trailing context first so the literal
    # ends on the array's closing bracket.
    $decoded = $null
    $c = $candidate
    while ($null -eq $decoded -and $c.Length -gt 1) {
      try { $decoded = ('"' + $c + '"') | ConvertFrom-Json -ErrorAction Stop } catch {
        $cut = $c.LastIndexOf(']', $c.Length - 2)
        if ($cut -lt 1) { break }
        $c = $c.Substring(0, $cut + 1)
      }
    }
    if ($decoded -isnot [string]) { break }
    $candidate = $decoded
  }
  throw "WNBA_PBE_PROOF_RESULT found but its array could not be decoded as JSON"
}
