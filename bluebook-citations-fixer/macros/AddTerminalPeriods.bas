Attribute VB_Name = "BluebookTerminalPeriods"
Option Explicit

' =============================================================================
' AddTerminalPeriods — companion Word macro for bluebook-citations-fixer
'
' Bluebook footnotes usually end in a citation sentence, and a citation
' sentence ends in a period. Zotero can't put that period there: the Epps
' Bluebook style leaves the citation suffix empty (a citation can also sit
' mid-sentence), and a Zotero plugin can't see what follows a field, so it
' can't tell whether the citation is the last thing in the note.
'
' This macro does the check Word can do and Zotero can't: for every footnote
' and endnote, if the last Zotero citation field has nothing but whitespace
' after it, insert a plain-text period right after the field. The period is
' ordinary document text, not field text, so Zotero → Refresh never touches
' it and you can delete it like any other character.
'
' Rules:
'   • Only Zotero citation fields (ADDIN ZOTERO_ITEM) count. Bibliography
'     fields and non-Zotero fields are ignored.
'   • If ANY visible character follows the field in the note — a
'     parenthetical, a closing quote, another sentence — nothing is added.
'   • If the citation already ends in terminal punctuation (Id., a name
'     ending in "Co.", a title ending in "?"), nothing is added.
'   • The inserted period is roman: italic / small caps / bold / underline
'     inherited from the end of the citation are cleared.
'   • Safe to re-run: a note that already has its period is left alone.
'
' Workflow: Zotero → Refresh, then run AddTerminalPeriods (bind it to a
' keystroke). Run AddTerminalPeriods_SelfTest once after installing to
' confirm it behaves in your copy of Word — it builds a throwaway document
' with fixture footnotes and reports pass/fail.
'
' Not handled: Zotero's Bookmarks field mode (used for Word↔LibreOffice
' interchange). Fields mode is the default in Word.
' =============================================================================

Private Const ZOTERO_ITEM_MARK As String = "ZOTERO_ITEM"

' Entry point: process the active document, report on the status bar.
Public Sub AddTerminalPeriods()
    Dim doc As Document
    Set doc = ActiveDocument

    Dim wasUpdating As Boolean
    wasUpdating = Application.ScreenUpdating
    Application.ScreenUpdating = False

    On Error Resume Next
    Application.UndoRecord.StartCustomRecord "Add terminal periods"
    On Error GoTo 0

    Dim added As Long
    added = AddTerminalPeriodsIn(doc)

    On Error Resume Next
    Application.UndoRecord.EndCustomRecord
    On Error GoTo 0

    Application.ScreenUpdating = wasUpdating
    Application.StatusBar = "Bluebook: added " & added & " terminal period(s)."
End Sub

' Process every footnote and endnote in doc; returns the number of periods added.
Public Function AddTerminalPeriodsIn(doc As Document) As Long
    Dim added As Long
    Dim fn As Footnote
    For Each fn In doc.Footnotes
        added = added + ProcessNote(fn.Range)
    Next fn
    Dim en As Endnote
    For Each en In doc.Endnotes
        added = added + ProcessNote(en.Range)
    Next en
    AddTerminalPeriodsIn = added
End Function

' One note. At most one field can qualify (only the last thing in the note
' has nothing after it), but checking every Zotero field keeps the logic
' uniform and order-independent.
Private Function ProcessNote(noteRange As Range) As Long
    Dim fld As Field
    Dim added As Long
    For Each fld In noteRange.Fields
        If IsZoteroCitation(fld) Then
            If NothingFollows(fld, noteRange) Then
                If Not EndsWithTerminalPunctuation(fld.Result.Text) Then
                    InsertPeriodAfter fld
                    added = added + 1
                End If
            End If
        End If
    Next fld
    ProcessNote = added
End Function

Private Function IsZoteroCitation(fld As Field) As Boolean
    IsZoteroCitation = False
    If fld.Type <> wdFieldAddin Then Exit Function
    On Error Resume Next
    IsZoteroCitation = (InStr(1, fld.Code.Text, ZOTERO_ITEM_MARK, vbBinaryCompare) > 0)
    On Error GoTo 0
End Function

' True when only whitespace / paragraph marks / field markers separate the
' end of fld from the end of the note.
Private Function NothingFollows(fld As Field, noteRange As Range) As Boolean
    Dim after As Range
    Set after = noteRange.Duplicate
    after.Start = fld.Result.End
    NothingFollows = (Len(StripInvisible(after.Text)) = 0)
End Function

' Insert "." immediately after the field's end-of-field marker, as roman text.
Private Sub InsertPeriodAfter(fld As Field)
    Dim r As Range
    Set r = fld.Result.Duplicate
    r.Collapse wdCollapseEnd
    r.Move wdCharacter, 1          ' step over the end-of-field marker (Chr(21))
    r.InsertAfter "."              ' r now spans the inserted period
    With r.Font
        .Italic = False
        .SmallCaps = False
        .Bold = False
        .Underline = wdUnderlineNone
    End With
End Sub

' True when the citation's rendered text already ends a sentence.
' Trailing closing quotes are looked through: `...Smith."` counts as ended.
Private Function EndsWithTerminalPunctuation(resultText As String) As Boolean
    Dim s As String
    s = StripInvisible(resultText)
    Do While Len(s) > 0 And IsClosingQuote(Right$(s, 1))
        s = Left$(s, Len(s) - 1)
    Loop
    If Len(s) = 0 Then
        EndsWithTerminalPunctuation = False
    Else
        EndsWithTerminalPunctuation = (InStr(".?!", Right$(s, 1)) > 0)
    End If
End Function

Private Function IsClosingQuote(ch As String) As Boolean
    Select Case AscW(ch)
        Case 34, 39, 8217, 8221, 187, 8250   ' " ' ’ ” » ›
            IsClosingQuote = True
        Case Else
            IsClosingQuote = False
    End Select
End Function

' Remove characters that don't count as "something after the citation":
' whitespace, paragraph/line marks, field markers, note reference marks,
' zero-width spaces, no-break spaces.
Private Function StripInvisible(s As String) As String
    Dim out As String
    Dim i As Long, code As Long
    For i = 1 To Len(s)
        code = AscW(Mid$(s, i, 1))
        Select Case code
            Case 1 To 32, 160, 8203, 8204, 8205, 8288, 65279
                ' control chars (incl. Chr(2) note mark, 9 tab, 11 VT, 13 CR,
                ' 19/20/21 field markers), space, NBSP, zero-width chars
            Case Else
                out = out & Mid$(s, i, 1)
        End Select
    Next i
    StripInvisible = out
End Function

' =============================================================================
' Self-test: builds a new document with fixture footnotes, runs the macro
' twice (the second run must add nothing), and writes PASS/FAIL lines into
' the document body. Nothing outside the new document is touched.
' =============================================================================
Public Sub AddTerminalPeriods_SelfTest()
    Dim doc As Document
    Set doc = Documents.Add
    doc.Content.Text = "Self-test for AddTerminalPeriods."

    Const CITE As String = "Smith, supra note 3, at 5"
    Const ID_CITE As String = "Id. at 7"        ' ends with "7" -> period expected
    Const BARE_ID As String = "Id."             ' already ends with "." -> none

    ' fixture: fields/text in order, expected note text after the macro
    Dim names(1 To 8) As String, expected(1 To 8) As String

    names(1) = "cite alone at end of note"
    AddFixture doc, Array(F(CITE))
    expected(1) = CITE & "."

    names(2) = "cite followed by free text"
    AddFixture doc, Array(F(CITE), T(" (discussing the point)."))
    expected(2) = CITE & " (discussing the point)."

    names(3) = "bare Id. at end of note"
    AddFixture doc, Array(F(BARE_ID))
    expected(3) = BARE_ID

    names(4) = "Id. at <page> at end of note"
    AddFixture doc, Array(F(ID_CITE))
    expected(4) = ID_CITE & "."

    names(5) = "two cites separated by hand-typed text"
    AddFixture doc, Array(F(CITE), T("; see also "), F("Jones, supra note 4"))
    expected(5) = CITE & "; see also Jones, supra note 4."

    names(6) = "cite followed only by a space"
    AddFixture doc, Array(F(CITE), T(" "))
    expected(6) = CITE & ". "

    names(7) = "non-Zotero ADDIN field at end of note"
    AddFixture doc, Array(F("Not a citation", "ADDIN SOMETHING_ELSE"))
    expected(7) = "Not a citation"

    names(8) = "cite ending in a question mark"
    AddFixture doc, Array(F("Smith, Is This a Title?"))
    expected(8) = "Smith, Is This a Title?"

    Dim firstRun As Long, secondRun As Long
    firstRun = AddTerminalPeriodsIn(doc)
    secondRun = AddTerminalPeriodsIn(doc)

    Dim report As String, failures As Long, i As Long, actual As String
    For i = 1 To 8
        actual = NoteText(doc.Footnotes(i))
        If actual = expected(i) Then
            report = report & "PASS  " & names(i) & vbCr
        Else
            failures = failures + 1
            report = report & "FAIL  " & names(i) & vbCr & _
                     "      expected: [" & expected(i) & "]" & vbCr & _
                     "      actual:   [" & actual & "]" & vbCr
        End If
    Next i
    If firstRun <> 4 Then
        failures = failures + 1
        report = report & "FAIL  first run added " & firstRun & " period(s); expected 4" & vbCr
    Else
        report = report & "PASS  first run added 4 periods" & vbCr
    End If
    If secondRun <> 0 Then
        failures = failures + 1
        report = report & "FAIL  second run added " & secondRun & " period(s); expected 0 (idempotency)" & vbCr
    Else
        report = report & "PASS  second run added 0 periods (idempotent)" & vbCr
    End If

    doc.Content.InsertParagraphAfter
    doc.Content.InsertAfter report
    doc.Content.InsertAfter IIf(failures = 0, "ALL PASSED", failures & " FAILURE(S)")
    Application.StatusBar = "AddTerminalPeriods self-test: " & _
        IIf(failures = 0, "all passed", failures & " failure(s)") & " — see the new document."
End Sub

' --- self-test helpers ------------------------------------------------------

' A fixture part describing a field: result text + field code.
Private Function F(resultText As String, Optional code As String = "") As Variant
    If Len(code) = 0 Then code = "ADDIN ZOTERO_ITEM CSL_CITATION {""citationID"":""selftest""}"
    F = Array("field", resultText, code)
End Function

' A fixture part describing hand-typed text.
Private Function T(txt As String) As Variant
    T = Array("text", txt, "")
End Function

' Append a footnote at the end of the body and fill it with the parts in order.
Private Sub AddFixture(doc As Document, parts As Variant)
    Dim anchor As Range
    Set anchor = doc.Content
    anchor.Collapse wdCollapseEnd
    anchor.Move wdCharacter, -1          ' before the final paragraph mark
    Dim fn As Footnote
    Set fn = doc.Footnotes.Add(anchor)

    Dim part As Variant, r As Range, fld As Field
    For Each part In parts
        Set r = fn.Range
        r.Collapse wdCollapseEnd
        If part(0) = "field" Then
            Set fld = doc.Fields.Add(r, wdFieldEmpty, CStr(part(2)), False)
            fld.Result.Text = CStr(part(1))
        Else
            r.InsertAfter CStr(part(1))
        End If
    Next part
End Sub

' The note's visible text: field results, no field codes, no reference mark,
' no trailing paragraph mark. Interior spaces are preserved so a trailing
' space fixture can be checked exactly.
Private Function NoteText(fn As Footnote) As String
    Dim r As Range
    Set r = fn.Range.Duplicate
    r.TextRetrievalMode.IncludeFieldCodes = False
    r.TextRetrievalMode.IncludeHiddenText = True
    Dim s As String, i As Long, code As Long, out As String
    s = r.Text
    For i = 1 To Len(s)
        code = AscW(Mid$(s, i, 1))
        Select Case code
            Case 2, 13, 19, 20, 21
            Case Else
                out = out & Mid$(s, i, 1)
        End Select
    Next i
    NoteText = out
End Function
