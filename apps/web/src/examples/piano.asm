; Keyboard piano: play the computer's keyboard like a piano, through interrupts.
;
;   Terminal  each key interrupts the CPU (RST 7); its handler plays the note
;             at once, on the next of the sound chip's three voices
;   Timer     ticks every 20 ms (RST 1); its handler fades the notes out
;   Sound     three voices, so you can play chords; low notes on the left,
;             high notes on the right
;   Display   a piano, with notes rising from the keys as you play
;   LEDs      light under the keys that are sounding
;
; The main program never reads the keyboard: it sleeps in HLT and draws
; whenever the timer wakes it. Both handlers save every register they use,
; since they can interrupt it anywhere. When a key and a tick arrive
; together, the key goes first: RST 7 outranks RST 1.
;
; Run it at 2 MHz or Max. The timer keeps real time at every speed, and at
; 30 Hz and 500 Hz it ticks again before the CPU has finished handling it.

STATUS   EQU 10h
DATA     EQU 11h
LEDS     EQU 20h
TIMER    EQU 30h
SOUND    EQU 40h            ; voice n's ports: 40h + 4n, then +0 note,
                            ; +1 waveform, +2 volume, +3 pan
TRIANGLE EQU 1
VRAM     EQU 0F000h
KEYS     EQU 13             ; C to the next C: 8 white keys, 5 black
NONE     EQU 0FFh           ; a voice that isn't playing

        ORG 0
        JMP main

        ORG 08h             ; RST 1: the timer ticked
        JMP tick

        ORG 38h             ; RST 7: a key arrived
        JMP key

main:   LXI SP, 0E000h
        LXI H, intro
        CALL puts
        MVI A, TRIANGLE     ; a soft triangle wave on every voice
        OUT SOUND+1
        OUT SOUND+5
        OUT SOUND+9
        LXI H, VRAM + 24*32 ; the keyboard's background: dark grey, which
        LXI B, 8*32         ; shows between the white keys
mn1:    MVI M, 8
        INX H
        DCX B
        MOV A, B
        ORA C
        JNZ mn1
        MVI A, 20           ; tick every 20 ms
        OUT TIMER
        MVI A, 80h          ; interrupt when a key arrives
        OUT STATUS
        EI

; Sleep until an interrupt. Every third tick, move the notes up and draw.
loop:   HLT
        LDA frame
        CPI 3
        JC loop
        XRA A
        STA frame
        CALL scroll
        CALL rain
        MVI A, 3            ; white keys first, then the black ones over them
        STA pass
        CALL keypass
        MVI A, 2
        STA pass
        CALL keypass
        JMP loop

; The key handler: play the key's note on the next voice, at full volume.
key:    PUSH PSW
        PUSH B
        PUSH D
        PUSH H
        IN DATA             ; reading the key lowers the interrupt
        ORI 20h             ; lower case
        CPI 'z'
        JZ octdown
        CPI 'x'
        JZ octup
        MOV D, A            ; which piano key is it?
        LXI H, keymap
        MVI B, 0
ky1:    MOV A, M
        ORA A
        JZ done             ; not one of ours
        CMP D
        JZ ky2
        INX H
        INR B
        JMP ky1
ky2:    LDA nextv           ; B = the key; C = the voice to play it on
        MOV C, A
        INR A
        CPI 3
        JC ky3
        XRA A
ky3:    STA nextv
        LXI H, vnote        ; remember what the voice plays
        CALL voiceat
        MOV M, B
        LXI H, vvol
        CALL voiceat
        MVI M, 15
        PUSH B
        LDA octave          ; the note: (octave + 1) x 12 + key
        INR A
        MOV E, A
        XRA A
ky4:    ADI 12
        DCR E
        JNZ ky4
        ADD B
        MOV B, A
        MVI E, 0
        CALL voiceout
        POP B
        PUSH B
        MOV A, B            ; pan by the key: C far left, C far right
        ADD A
        ADD A
        ADD A
        ADD A
        SUI 96
        MOV B, A
        MVI E, 3
        CALL voiceout
        MVI B, 15           ; full volume
        MVI E, 2
        CALL voiceout
        POP B
        MOV A, B            ; print the note's name
        ADD A
        LXI H, names
        CALL index
        OUT DATA
        INX H
        MOV A, M            ; the sharp, if any
        CPI ' '
        JZ ky6
        OUT DATA
ky6:    LDA octave          ; the octave: one higher for the top C
        MOV E, A
        MOV A, B
        CPI KEYS - 1
        MOV A, E
        JNZ ky5
        INR A
ky5:    ADI '0'
        OUT DATA
        MVI A, ' '
        OUT DATA
        JMP done

octdown:
        LDA octave
        CPI 2
        JC done
        DCR A
        JMP octset
octup:  LDA octave
        CPI 6
        JNC done
        INR A
octset: STA octave
        MOV B, A
        LXI H, octmsg
        CALL puts
        MOV A, B
        ADI '0'
        OUT DATA
        MVI A, 10
        OUT DATA

done:   POP H
        POP D
        POP B
        POP PSW
        EI
        RET

; The timer handler: every other tick, each sounding voice gets quieter,
; until it stops. The LEDs show the keys still sounding.
tick:   PUSH PSW
        PUSH B
        PUSH D
        PUSH H
        LDA frame
        INR A
        STA frame
        LDA parity
        XRI 1
        STA parity
        JNZ tk3
        MVI C, 0            ; C = voice
tk1:    LXI H, vnote
        CALL voiceat
        MOV A, M
        CPI NONE
        JZ tk2
        LXI H, vvol
        CALL voiceat
        DCR M
        MOV B, M
        MVI E, 2            ; the voice's new volume
        CALL voiceout
        MOV A, B
        ORA A
        JNZ tk2
        LXI H, vnote        ; faded out: stop the note
        CALL voiceat
        MVI M, NONE
        MVI E, 0
        CALL voiceout       ; B = 0: silence
tk2:    INR C
        MOV A, C
        CPI 3
        JNZ tk1
tk3:    MVI D, 0            ; light the LEDs under the sounding keys
        MVI C, 0
tk4:    LXI H, vnote
        CALL voiceat
        MOV A, M
        CPI NONE
        JZ tk5
        LXI H, ledbit
        CALL index
        ORA D
        MOV D, A
tk5:    INR C
        MOV A, C
        CPI 3
        JNZ tk4
        MOV A, D
        OUT LEDS
        JMP done

; HL = HL + C: voice C's entry in a table of three.
voiceat:
        MOV A, L
        ADD C
        MOV L, A
        MOV A, H
        ACI 0
        MOV H, A
        RET

; Write B to voice C's port E: port 40h + 4C + E. OUT only takes a fixed
; port, so this one writes the port into its own OUT instruction first.
voiceout:
        MOV A, C
        ADD A
        ADD A
        ADD E
        ADI SOUND
        STA vo1+1
        MOV A, B
vo1:    OUT SOUND           ; the port is filled in above
        RET

; Move the notes up a row: copy rows 1-23 of the display to rows 0-22.
scroll: LXI H, VRAM + 32
        LXI D, VRAM
        LXI B, 23*32
sc1:    MOV A, M
        STAX D
        INX H
        INX D
        DCX B
        MOV A, B
        ORA C
        JNZ sc1
        RET

; Draw row 23, just above the keys: a dot of colour over each sounding key.
rain:   XRA A
        STA colour
        MVI B, 0            ; clear the row
        MVI C, 32
        MVI D, 23
        MVI E, 1
        CALL box
        XRA A
rn1:    STA voice
        MOV C, A
        LXI H, vnote
        CALL voiceat
        MOV A, M
        CPI NONE
        JZ rn2
        STA idx
        LXI H, notecol
        CALL index
        STA colour
        CALL keyshape
        MVI D, 23
        MVI E, 1
        CALL box
rn2:    LDA voice
        INR A
        CPI 3
        JNZ rn1
        RET

; Draw the keys as wide as `pass` (3 for white, 2 for black), each in its
; note's colour while it sounds.
keypass:
        XRA A
kp1:    STA idx
        LXI H, keyw
        CALL index
        LXI H, pass
        CMP M
        JNZ kp4
        LDA idx
        CALL playing
        LXI H, notecol      ; sounding: the note's colour
        JNZ kp2
        LXI H, keycol       ; not: white or black
kp2:    LDA idx
        CALL index
        STA colour
        CALL keyshape
        MVI D, 24           ; from the top of the keyboard
        MVI E, 8            ; white keys are 8 rows tall
        MOV A, C
        CPI 3
        JZ kp3
        MVI E, 5            ; black keys 5
kp3:    CALL box
kp4:    LDA idx
        INR A
        CPI KEYS
        JNZ kp1
        RET

; B = key `idx`'s left edge, C = its width.
keyshape:
        LDA idx
        LXI H, keyx
        CALL index
        MOV B, A
        LDA idx
        LXI H, keyw
        CALL index
        MOV C, A
        RET

; NZ if a voice is playing key A, Z if not.
playing:
        PUSH B
        MOV B, A
        LXI H, vnote
        MVI C, 3
pl1:    MOV A, M
        CMP B
        JZ pl2
        INX H
        DCR C
        JNZ pl1
        POP B
        XRA A               ; Z: no
        RET
pl2:    POP B
        MVI A, 1
        ORA A               ; NZ: yes
        RET

; Fill a box in `colour`: left edge B, width C, from row D, E rows tall.
box:    MOV L, D            ; HL = VRAM + D x 32 + B
        MVI H, 0
        DAD H
        DAD H
        DAD H
        DAD H
        DAD H
        MOV A, L
        ORA B
        MOV L, A
        MOV A, H
        ADI HIGH VRAM
        MOV H, A
bx1:    PUSH H
        MOV B, C            ; B = pixels left in this row
        LDA colour
bx2:    MOV M, A
        INX H
        DCR B
        JNZ bx2
        POP H
        MOV A, L            ; down a row
        ADI 32
        MOV L, A
        MOV A, H
        ACI 0
        MOV H, A
        DCR E
        JNZ bx1
        RET

; A = the byte at HL + A. Changes HL.
index:  ADD L
        MOV L, A
        MVI A, 0            ; MVI leaves the carry for ADC
        ADC H
        MOV H, A
        MOV A, M
        RET

; Print the zero-terminated string at HL.
puts:   MOV A, M
        ORA A
        RZ
        OUT DATA
        INX H
        JMP puts

; The 13 keys, C to C:     C  C# D  D# E  F  F# G  G# A  A# B  C
keymap: DB "awsedftgyhujk", 0
keyx:   DB 0, 3, 4, 7, 8, 12, 15, 16, 19, 20, 23, 24, 28     ; left edges
keyw:   DB 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 3, 3            ; white 3, black 2
keycol: DB 7, 0, 7, 0, 7, 7, 0, 7, 0, 7, 0, 7, 7            ; grey or black
notecol:
        DB 12, 4, 14, 6, 10, 11, 3, 9, 1, 13, 5, 15, 12     ; a rainbow
ledbit: DB 80h, 0C0h, 40h, 60h, 20h, 10h, 18h, 8, 0Ch, 4, 6, 2, 1
names:  DB "C C#D D#E F F#G G#A A#B C "

intro:  DB 12, "KEYBOARD PIANO", 10, 10
        DB "Play the keys like a piano:", 10, 10
        DB "     w e   t y u", 10
        DB "    a s d f g h j k", 10
        DB "    C D E F G A B C", 10, 10
        DB "z and x: an octave down and up.", 10, 10, 0
octmsg: DB 10, "Octave ", 0

; Variables
octave: DB 4                ; a: middle C (C4)
nextv:  DB 0                ; the voice the next key plays on
vnote:  DB NONE, NONE, NONE ; each voice's key, or NONE
vvol:   DB 0, 0, 0          ; and its volume
frame:  DB 0                ; ticks since the last frame
parity: DB 0                ; the notes fade every other tick
pass:   DB 0
idx:    DB 0
voice:  DB 0
colour: DB 0
