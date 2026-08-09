param(
    [string]$PngOutput = (Join-Path (Get-Location).Path "assets\app-icon.png"),
    [string]$IcoOutput = (Join-Path (Get-Location).Path "assets\app-icon.ico"),
    [string]$WindowIconOutput = (Join-Path (Get-Location).Path "public\logoPng.png")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Ensure-ParentDirectory {
    param([string]$FilePath)

    $parent = Split-Path -Parent $FilePath
    if ($parent -and !(Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function New-IcoFromPng {
    param(
        [string]$PngPath,
        [string]$IcoPath
    )

    [byte[]]$pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
    if ($pngBytes.Length -lt 24) {
        throw "PNG source is invalid or too small."
    }

    $width = [System.BitConverter]::ToUInt32([byte[]]($pngBytes[19], $pngBytes[18], $pngBytes[17], $pngBytes[16]), 0)
    $height = [System.BitConverter]::ToUInt32([byte[]]($pngBytes[23], $pngBytes[22], $pngBytes[21], $pngBytes[20]), 0)

    $iconDir = New-Object byte[] 6
    $iconDir[2] = 1
    $iconDir[4] = 1

    $entry = New-Object byte[] 16
    $entry[0] = if ($width -ge 256) { 0 } else { [byte]$width }
    $entry[1] = if ($height -ge 256) { 0 } else { [byte]$height }
    $entry[2] = 0
    $entry[3] = 0
    $entry[4] = 1
    $entry[5] = 0
    $entry[6] = 32
    $entry[7] = 0

    [byte[]]$sizeBytes = [System.BitConverter]::GetBytes([uint32]$pngBytes.Length)
    [byte[]]$offsetBytes = [System.BitConverter]::GetBytes([uint32]22)
    [Array]::Copy($sizeBytes, 0, $entry, 8, 4)
    [Array]::Copy($offsetBytes, 0, $entry, 12, 4)

    $stream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
    try {
        $stream.Write($iconDir, 0, $iconDir.Length)
        $stream.Write($entry, 0, $entry.Length)
        $stream.Write($pngBytes, 0, $pngBytes.Length)
    } finally {
        $stream.Dispose()
    }
}

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-LabFlowIconBitmap {
    param([int]$CanvasSize = 512)

    $bitmap = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

        $scale = $CanvasSize / 64.0
        $tileX = [float](6 * $scale)
        $tileY = [float](6 * $scale)
        $tileSize = [float](52 * $scale)
        $tileRadius = [float](16 * $scale)

        $tilePath = New-RoundedRectanglePath -X $tileX -Y $tileY -Width $tileSize -Height $tileSize -Radius $tileRadius
        try {
            $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
                (New-Object System.Drawing.Point ([int]$tileX), ([int]$tileY)),
                (New-Object System.Drawing.Point ([int]($tileX + $tileSize)), ([int]($tileY + $tileSize))),
                ([System.Drawing.Color]::FromArgb(255, 43, 124, 255)),
                ([System.Drawing.Color]::FromArgb(255, 10, 63, 160))
            )

            try {
                $graphics.FillPath($tileBrush, $tilePath)
            } finally {
                $tileBrush.Dispose()
            }

            $clipState = $graphics.Save()
            try {
                $graphics.SetClip($tilePath)
                $sheenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(58, 255, 255, 255))
                try {
                    $graphics.FillEllipse(
                        $sheenBrush,
                        [float](-7 * $scale),
                        [float](-4 * $scale),
                        [float](42 * $scale),
                        [float](24 * $scale)
                    )
                } finally {
                    $sheenBrush.Dispose()
                }
            } finally {
                $graphics.Restore($clipState)
            }
        } finally {
            $tilePath.Dispose()
        }

        $markBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
        try {
            $graphics.FillRectangle(
                $markBrush,
                [float](18 * $scale),
                [float](18 * $scale),
                [float](7 * $scale),
                [float](24 * $scale)
            )

            $graphics.FillRectangle(
                $markBrush,
                [float](18 * $scale),
                [float](35 * $scale),
                [float](20 * $scale),
                [float](7 * $scale)
            )
        } finally {
            $markBrush.Dispose()
        }

        $accentPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0, 212, 255)), ([float](3.3 * $scale))
        try {
            $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $graphics.DrawEllipse(
                $accentPen,
                [float]((41.5 - 7.2) * $scale),
                [float]((25 - 7.2) * $scale),
                [float]((7.2 * 2) * $scale),
                [float]((7.2 * 2) * $scale)
            )
            $graphics.DrawLine(
                $accentPen,
                [float](46.6 * $scale),
                [float](30.2 * $scale),
                [float](51.8 * $scale),
                [float](35.6 * $scale)
            )
        } finally {
            $accentPen.Dispose()
        }

        return $bitmap
    } catch {
        $bitmap.Dispose()
        throw
    } finally {
        $graphics.Dispose()
    }
}

Ensure-ParentDirectory -FilePath $PngOutput
Ensure-ParentDirectory -FilePath $IcoOutput
Ensure-ParentDirectory -FilePath $WindowIconOutput

$iconBitmap = New-LabFlowIconBitmap -CanvasSize 512
try {
    $iconBitmap.Save($PngOutput, [System.Drawing.Imaging.ImageFormat]::Png)
    $iconBitmap.Save($WindowIconOutput, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $iconBitmap.Dispose()
}

New-IcoFromPng -PngPath $PngOutput -IcoPath $IcoOutput

Write-Host "Created LabFlow desktop icon files:"
Write-Host " - $PngOutput"
Write-Host " - $IcoOutput"
Write-Host " - $WindowIconOutput"
