-- Opens the .docx in Pages and exports a PDF preview next to it.
-- Usage: osascript export_pdf.applescript <in.docx> <out.pdf>
on run argv
	set inPath to POSIX file (item 1 of argv)
	set outPath to POSIX file (item 2 of argv)
	tell application id "com.apple.Pages"
		set theDoc to open inPath
		delay 2
		export theDoc to outPath as PDF
		close theDoc saving no
	end tell
end run
