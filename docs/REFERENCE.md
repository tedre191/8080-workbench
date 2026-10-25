# 8080 Workbench reference

This is the Reference tab of the workbench (F1), generated from the same tables.

## Instructions

| Operand | Means |
| --- | --- |
| `r` | A B C D E H L, or M for the byte at the address in HL |
| `rp` | register pair: B (BC), D (DE), H (HL), SP; PUSH/POP use PSW (A + flags) instead of SP |
| `d8, d16` | 8- or 16-bit value: a number, label, constant or expression |
| `addr` | a 16-bit address, usually a label |
| `port` | I/O port number, 0–255 |

Cycles are clock cycles (T-states).

### Move and load

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `MOV r, r` | Copy a register (or memory at HL, as M) to another. | none | 5–7 |
| `MVI r, d8` | Load an 8-bit constant into a register or memory at HL. | none | 7–10 |
| `LXI rp, d16` | Load a 16-bit constant into BC, DE, HL or SP. | none | 10 |
| `LDA addr` | Load A from memory. | none | 13 |
| `STA addr` | Store A to memory. | none | 13 |
| `LHLD addr` | Load L from addr and H from addr+1. | none | 16 |
| `SHLD addr` | Store L to addr and H to addr+1. | none | 16 |
| `LDAX B\|D` | Load A from the address in BC or DE. | none | 7 |
| `STAX B\|D` | Store A to the address in BC or DE. | none | 7 |
| `XCHG` | Swap DE and HL. | none | 4 |

### Arithmetic

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `ADD r` | A = A + r. | S Z AC P CY | 4–7 |
| `ADI d8` | A = A + d8. | S Z AC P CY | 7 |
| `ADC r` | A = A + r + carry. | S Z AC P CY | 4–7 |
| `ACI d8` | A = A + d8 + carry. | S Z AC P CY | 7 |
| `SUB r` | A = A − r. | S Z AC P CY | 4–7 |
| `SUI d8` | A = A − d8. | S Z AC P CY | 7 |
| `SBB r` | A = A − r − borrow. | S Z AC P CY | 4–7 |
| `SBI d8` | A = A − d8 − borrow. | S Z AC P CY | 7 |
| `INR r` | Increment a register or memory at HL. | S Z AC P (not CY) | 5–10 |
| `DCR r` | Decrement a register or memory at HL. | S Z AC P (not CY) | 5–10 |
| `INX rp` | Increment a register pair. | none | 5 |
| `DCX rp` | Decrement a register pair. | none | 5 |
| `DAD rp` | HL = HL + rp (16-bit add). | CY only | 10 |
| `DAA` | Adjust A to packed BCD after an addition. | S Z AC P CY | 4 |

### Logic and compare

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `ANA r` | A = A AND r. | S Z AC P, CY cleared | 4–7 |
| `ANI d8` | A = A AND d8. | S Z AC P, CY cleared | 7 |
| `ORA r` | A = A OR r. ORA A sets flags from A without changing it. | S Z P, AC and CY cleared | 4–7 |
| `ORI d8` | A = A OR d8. | S Z P, AC and CY cleared | 7 |
| `XRA r` | A = A XOR r. XRA A is a quick way to clear A. | S Z P, AC and CY cleared | 4–7 |
| `XRI d8` | A = A XOR d8. | S Z P, AC and CY cleared | 7 |
| `CMP r` | Compare A with r (subtract, discard result). Z if equal, CY if A < r. | S Z AC P CY | 4–7 |
| `CPI d8` | Compare A with d8. Z if equal, CY if A < d8. | S Z AC P CY | 7 |
| `CMA` | Complement A (A = NOT A). | none | 4 |
| `STC` | Set the carry flag. | CY only | 4 |
| `CMC` | Complement the carry flag. | CY only | 4 |

### Rotate

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `RLC` | Rotate A left; bit 7 goes to bit 0 and CY. | CY only | 4 |
| `RRC` | Rotate A right; bit 0 goes to bit 7 and CY. | CY only | 4 |
| `RAL` | Rotate A left through carry. | CY only | 4 |
| `RAR` | Rotate A right through carry. | CY only | 4 |

### Jump, call and return

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `JMP addr` | Jump to addr. | none | 10 |
| `Jcc addr` | Jump to addr if the condition holds. | none | 10 |
| `CALL addr` | Push the return address and jump to addr. | none | 17 |
| `Ccc addr` | Call addr if the condition holds. | none | 11–17 |
| `RET` | Return: pop the program counter. | none | 10 |
| `Rcc` | Return if the condition holds. | none | 5–11 |
| `RST n` | Call address n × 8. Interrupting devices usually supply this. | none | 11 |
| `PCHL` | Jump to the address in HL. | none | 5 |

### Stack

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `PUSH B\|D\|H\|PSW` | Push a register pair (PSW = A and flags). | none | 11 |
| `POP B\|D\|H\|PSW` | Pop a register pair (POP PSW restores flags). | POP PSW sets all | 10 |
| `XTHL` | Swap HL with the word on top of the stack. | none | 18 |
| `SPHL` | SP = HL. | none | 5 |

### I/O and control

| Syntax | Does | Flags | Cycles |
| --- | --- | --- | --- |
| `IN port` | Read a byte from an I/O port into A. | none | 10 |
| `OUT port` | Write A to an I/O port. | none | 10 |
| `EI` | Enable interrupts (after the next instruction). | none | 4 |
| `DI` | Disable interrupts. | none | 4 |
| `HLT` | Halt until an interrupt (or forever if interrupts are off). | none | 7 |
| `NOP` | Do nothing for 4 T-states. | none | 4 |

## Flags and conditions

| Flag | Means |
| --- | --- |
| `S` | Sign: bit 7 of the result |
| `Z` | Zero: the result was 0 |
| `AC` | Auxiliary carry out of bit 3, used by DAA |
| `P` | Parity: the result has an even number of 1 bits |
| `CY` | Carry out of bit 7, or a borrow on subtract and compare |

### Conditions for Jcc, Ccc and Rcc

| cc | When | After CMP x or CPI x |
| --- | --- | --- |
| `Z` | Z = 1 | A = x |
| `NZ` | Z = 0 | A ≠ x |
| `C` | CY = 1 | A < x (unsigned) |
| `NC` | CY = 0 | A ≥ x (unsigned) |
| `M` | S = 1 | A − x is negative (bit 7 set) |
| `P` | S = 0 | A − x is positive or zero |
| `PE` | P = 1 | result has even parity |
| `PO` | P = 0 | result has odd parity |

## Assembler syntax

| Syntax | Means |
| --- | --- |
| `label:` | Names the address of the next instruction. The colon is optional in column 0. |
| `; text` | Comment, to the end of the line. |
| `42  2Ah  0x2A  $2A` | Decimal and hex. Hex with h must start with a digit: 0FFh, not FFh. |
| `101010b  52o` | Binary and octal. |
| `'A'  "Hi"` | A character is its ASCII code; strings work in DB. |
| `$` | The address of the current instruction. |
| `+ - * / % << >> & \| ^ ~` | Arithmetic and bitwise operators, with parentheses. |
| `HIGH x  LOW x` | The high or low byte of a 16-bit value. |
| `ORG addr` | Assemble the following code starting at addr. |
| `name EQU value` | Define a constant. Also written name = value. |
| `name SET value` | Define a constant that may be redefined later. |
| `DB value, "text", …` | Emit bytes and strings. |
| `DW value, …` | Emit 16-bit words, low byte first. |
| `DS count[, fill]` | Reserve count bytes (optionally filled). |
| `END [entry]` | End of source; optionally set the entry point. |

## This machine

| Port or address | Does |
| --- | --- |
| `IN 10h` | Terminal status: bit 0 = a key is waiting, bit 1 = ready to send |
| `IN 11h` | Terminal: read the key |
| `OUT 11h` | Terminal: print a character |
| `OUT 10h` | Terminal control: 80h = interrupt with RST 7 while a key is waiting, 03h = reset |
| `OUT 20h` | LEDs, one per bit |
| `IN 21h` | Switches, one per bit |
| `OUT 30h` | Timer: n = interrupt every n ms with RST 1, 0 = stop |
| `F000h` | Display, 32×32: one byte per pixel, row by row, colours below |
| `OUT 40h, 44h, 48h` | Sound voices 0, 1, 2: play MIDI note n (60 = middle C, 69 = A 440 Hz), 0 = off |
| `… +1` | Sound voice’s waveform: 0 square, 1 triangle, 2 sawtooth, 3 noise |
| `… +2` | Sound voice’s volume, 0–15 |
| `… +3` | Sound voice’s pan: 80h far left, 0 centre, 7Fh far right |
| `RST n` | Calls address n × 8: 0000h, 0008h, … 0038h. Interrupts arrive as RST; when several are waiting, the highest RST goes first. |
| `LXI SP, 0E000h` | A good place for the stack; it grows down. |

### Display colours

| Colour | RGB |
| --- | --- |
| 0 | `#000000` |
| 1 | `#0000AA` |
| 2 | `#00AA00` |
| 3 | `#00AAAA` |
| 4 | `#AA0000` |
| 5 | `#AA00AA` |
| 6 | `#AA5500` |
| 7 | `#AAAAAA` |
| 8 | `#555555` |
| 9 | `#5555FF` |
| 10 | `#55FF55` |
| 11 | `#55FFFF` |
| 12 | `#FF5555` |
| 13 | `#FF55FF` |
| 14 | `#FFFF55` |
| 15 | `#FFFFFF` |

## Snippets

### Counted loop

Repeat something up to 255 times, counting down in B.

```asm
        MVI B, 10           ; repeat 10 times
loop:   ; ...your code...
        DCR B
        JNZ loop
```

### 16-bit loop or delay

Count BC down from up to 65535. DCX sets no flags, so test for zero by hand.

```asm
        LXI B, 1000         ; 1000 x 24 T-states = 12 ms at 2 MHz
delay:  DCX B
        MOV A, B
        ORA C
        JNZ delay
```

### Compare and branch

Compare A with a value and go three ways.

```asm
        CPI 10              ; compare A with 10
        JZ equal            ; A = 10
        JC less             ; A < 10
more:   ; A > 10
        JMP done
less:   ; A < 10
        JMP done
equal:  ; A = 10
done:
```

### Print a string

Send a zero-terminated string to the terminal.

```asm
        LXI H, message
        CALL print
        HLT

; Print the zero-terminated string at HL.
print:  MOV A, M
        ORA A
        RZ
        OUT 11h             ; terminal data port
        INX H
        JMP print

message:
        DB "Hello!", 10, 0
```

### Wait for a key

Poll the terminal until a key arrives, then read it into A.

```asm
waitkey:
        IN 10h              ; terminal status
        ANI 01h             ; bit 0: a key is waiting
        JZ waitkey
        IN 11h              ; A = the key
```

### Switches to LEDs

Read the switches and show them on the LEDs.

```asm
        IN 21h              ; A = switch positions
        OUT 20h             ; light the LEDs to match
```

### Plot a pixel

Set the pixel at (x, y) on the 32x32 display to a colour.

```asm
        MVI B, 5            ; y
        MVI C, 7            ; x
        MVI E, 14           ; colour (14 = yellow)
        MOV L, B            ; HL = F000h + y * 32 + x
        MVI H, 0
        DAD H               ; y * 2
        DAD H               ; y * 4
        DAD H               ; y * 8
        DAD H               ; y * 16
        DAD H               ; y * 32
        MOV A, L
        ORA C               ; low 5 bits are free, so OR adds x
        MOV L, A
        MOV A, H
        ADI HIGH 0F000h
        MOV H, A
        MOV M, E
```

### Play a note

Play middle C for about a quarter of a second, then stop.

```asm
        MVI A, 60           ; MIDI note 60 = middle C (69 = A 440 Hz)
        OUT 40h             ; start the note
        LXI B, 21000        ; about 250 ms at 2 MHz
delay:  DCX B
        MOV A, B
        ORA C
        JNZ delay
        XRA A
        OUT 40h             ; note 0 = silence
```

### Multiply by 10

Multiply A by a constant with shifts (adding A to itself) and adds.

```asm
        MOV B, A
        ADD A               ; A * 2
        ADD A               ; A * 4
        ADD B               ; A * 5
        ADD A               ; A * 10
```

### Program with a timer interrupt

A whole program: the timer calls RST 1 (address 0008h) every 100 ms.

```asm
        ORG 0
        JMP main

        ORG 08h             ; RST 1 lands here
tick:   PUSH PSW            ; save what the handler changes
        ; ...handle the tick...
        POP PSW
        EI                  ; interrupts are off on entry
        RET

main:   LXI SP, 0E000h
        MVI A, 100          ; tick every 100 ms
        OUT 30h
        EI
wait:   HLT                 ; sleep until an interrupt
        JMP wait
```

### Read keys with an interrupt

A whole program: each key interrupts with RST 7 (address 0038h) and lands in a buffer; the main loop echoes them and sleeps in between.

```asm
        ORG 0
        JMP main

        ORG 38h             ; RST 7: a key arrived
        PUSH PSW            ; save what the handler changes
        PUSH H
        IN 11h              ; read the key; this lowers the interrupt
        LHLD tail           ; and add it to the buffer
        MOV M, A
        INR L               ; the buffer is one page, so L wraps around
        SHLD tail
        POP H
        POP PSW
        EI                  ; interrupts are off on entry
        RET

main:   LXI SP, 0E000h
        LXI H, 8000h        ; the buffer: 8000h-80FFh
        SHLD head
        SHLD tail
        MVI A, 80h          ; interrupt while a key is waiting
        OUT 10h
loop:   DI                  ; check the buffer with interrupts off...
        LHLD head
        LDA tail
        CMP L
        JNZ echo
        EI                  ; ...EI only takes effect after HLT starts,
        HLT                 ; so a key can't slip in between and be missed
        JMP loop
echo:   EI
        MOV A, M            ; echo the oldest key
        OUT 11h
        INR L
        SHLD head
        JMP loop

head:   DW 0                ; the next key to echo
tail:   DW 0                ; where the next key goes
```
