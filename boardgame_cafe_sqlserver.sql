/* =========================================================
   Board Game Cafe Management System
   SQL Server 2019 — Full Schema + Business Logic
   ตามรายละเอียด:
     ส่วนที่ 1: เล่นที่ร้าน (Check-in/Pre-paid, หยิบเกม, Clear, Smart Extension+Queue)
     ส่วนที่ 2: เช่ากลับบ้าน (ลงทะเบียน+เลขบัตร ปชช. 13 หลัก, เช่า, คืน)
   ========================================================= */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- จำเป็นสำหรับ filtered index
GO

IF DB_ID('BoardGameCafeDB') IS NOT NULL
BEGIN
    ALTER DATABASE BoardGameCafeDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE BoardGameCafeDB;
END
GO

CREATE DATABASE BoardGameCafeDB;
GO
USE BoardGameCafeDB;
GO

/* =========================================================
   1. TABLES
   ========================================================= */

-- ลูกค้า (ใช้ร่วมกันทั้ง walk-in สมาชิก และลูกค้าเช่ากลับบ้าน)
CREATE TABLE tbl_customer (
    CustomerID   INT IDENTITY(1,1) PRIMARY KEY,
    FirstName    VARCHAR(50)  NOT NULL,
    LastName     VARCHAR(50)  NOT NULL,
    Phone        VARCHAR(15)  NOT NULL UNIQUE,
    NationalID   CHAR(13)     NULL,          -- บังคับกรอกตอนเช่ากลับบ้าน (ห้ามซ้ำ: UX_customer_nationalid)
    Points       INT          NOT NULL DEFAULT 0,
    CreatedDate  DATETIME     NOT NULL DEFAULT GETDATE(),
    PasswordHash VARCHAR(100) NULL,          -- bcrypt hash (NULL = ยังไม่มีบัญชีเว็บ)
    CONSTRAINT CK_customer_NationalID
        CHECK (NationalID IS NULL OR (LEN(NationalID) = 13 AND NationalID NOT LIKE '%[^0-9]%'))
);
GO

-- พนักงาน
CREATE TABLE tbl_employee (
    EmployeeID  INT IDENTITY(1,1) PRIMARY KEY,
    Name        VARCHAR(100) NOT NULL,
    Position    VARCHAR(50),
    Phone       VARCHAR(15),
    Username    VARCHAR(30) NULL,            -- สำหรับ login ฝั่งแอดมิน
    PasswordHash VARCHAR(100) NULL           -- bcrypt hash
);
GO

-- หมวดหมู่บอร์ดเกม
CREATE TABLE tbl_gamecategory (
    CategoryID    INT IDENTITY(1,1) PRIMARY KEY,
    CategoryName  VARCHAR(50) NOT NULL
);
GO

-- บอร์ดเกม (มีสต๊อกแยกในร้าน/เช่ากลับบ้านใช้สต๊อกร่วมกัน)
CREATE TABLE tbl_boardgame (
    GameID             INT IDENTITY(1,1) PRIMARY KEY,
    Name               VARCHAR(100) NOT NULL,
    CategoryID         INT NULL REFERENCES tbl_gamecategory(CategoryID),
    MinPlayer          TINYINT,
    MaxPlayer          TINYINT,
    Difficulty         VARCHAR(20),
    TotalQty           SMALLINT NOT NULL DEFAULT 1,
    AvailableQty       SMALLINT NOT NULL DEFAULT 1,
    OffsiteRentalRate  DECIMAL(10,2) NOT NULL DEFAULT 0,   -- ราคาเช่ากลับบ้าน/ครั้ง
    DepositAmount      DECIMAL(10,2) NOT NULL DEFAULT 0,   -- ค่ามัดจำ
    ImageUrl           VARCHAR(255) NULL,                   -- รูปเกม (เช่น /images/games/catan.svg)
    PlayTime           NVARCHAR(30) NULL,                   -- เวลาเล่นโดยประมาณ
    ShortDescription   NVARCHAR(400) NULL,                  -- รายละเอียดเกมแบบย่อ
    HowToPlay          NVARCHAR(2000) NULL,                 -- วิธีเล่นแบบย่อ (1 บรรทัด = 1 ขั้นตอน)
    CONSTRAINT CK_boardgame_qty CHECK (AvailableQty >= 0 AND AvailableQty <= TotalQty)
);
GO

-- โต๊ะ/โซน
CREATE TABLE tbl_table (
    TableID    INT IDENTITY(1,1) PRIMARY KEY,
    Zone       VARCHAR(20),
    Capacity   TINYINT NOT NULL,
    HourlyRate DECIMAL(10,2) NOT NULL DEFAULT 0,
    Status     VARCHAR(20) NOT NULL DEFAULT 'Available'
        CHECK (Status IN ('Available','Occupied'))
);
GO

-- แพ็กเกจเวลาเหมาจ่าย
CREATE TABLE tbl_timepackage (
    PackageID        INT IDENTITY(1,1) PRIMARY KEY,
    PackageName      VARCHAR(50) NOT NULL,     -- '1 ชั่วโมง' / '2 ชั่วโมง' / 'เหมาวัน'
    DurationMinutes  INT NULL,                 -- NULL = เหมาวัน (ปิดร้าน)
    Price            DECIMAL(10,2) NOT NULL
);
GO

-- คิวรอโต๊ะ (TableID = คิวรอโต๊ะไหน, NULL = คิวรวมไม่ระบุโต๊ะ)
CREATE TABLE tbl_queue (
    QueueID       INT IDENTITY(1,1) PRIMARY KEY,
    CustomerName  VARCHAR(100) NOT NULL,
    Phone         VARCHAR(15) NULL,
    QueueTime     DATETIME NOT NULL DEFAULT GETDATE(),
    Status        VARCHAR(20) NOT NULL DEFAULT 'Waiting'
        CHECK (Status IN ('Waiting','Seated','Cancelled')),
    TableID       INT NULL CONSTRAINT FK_queue_table REFERENCES tbl_table(TableID),
    CustomerID    INT NULL CONSTRAINT FK_queue_customer REFERENCES tbl_customer(CustomerID)
);
GO

-- การเปิดโต๊ะ / เช็คอิน (1 session ต่อการนั่งเล่น 1 รอบ)
CREATE TABLE tbl_session (
    SessionID        INT IDENTITY(1,1) PRIMARY KEY,
    TableID          INT NOT NULL REFERENCES tbl_table(TableID),
    CustomerID       INT NULL REFERENCES tbl_customer(CustomerID),   -- walk-in ไม่บังคับลงทะเบียน
    PackageID        INT NOT NULL REFERENCES tbl_timepackage(PackageID),
    EmployeeID       INT NOT NULL REFERENCES tbl_employee(EmployeeID),
    StartTime        DATETIME NOT NULL DEFAULT GETDATE(),
    ExpectedEndTime  DATETIME NOT NULL,
    ActualEndTime    DATETIME NULL,
    AmountPaid       DECIMAL(10,2) NOT NULL DEFAULT 0,
    Status           VARCHAR(20) NOT NULL DEFAULT 'Active'
        CHECK (Status IN ('Active','Completed')),
    CONSTRAINT CK_session_time CHECK (ExpectedEndTime > StartTime)
);
GO

-- ประวัติการต่อเวลา
CREATE TABLE tbl_sessionextension (
    ExtensionID      INT IDENTITY(1,1) PRIMARY KEY,
    SessionID        INT NOT NULL REFERENCES tbl_session(SessionID),
    ExtendedMinutes  INT NOT NULL,
    AdditionalFee    DECIMAL(10,2) NOT NULL,
    ExtendedAt       DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- เกมที่หยิบเข้าโต๊ะ (เล่นในร้าน) — junction table ระหว่าง session กับ boardgame
CREATE TABLE tbl_instoreborrow (
    BorrowID    INT IDENTITY(1,1) PRIMARY KEY,
    SessionID   INT NOT NULL REFERENCES tbl_session(SessionID),
    GameID      INT NOT NULL REFERENCES tbl_boardgame(GameID),
    BorrowTime  DATETIME NOT NULL DEFAULT GETDATE(),
    ReturnTime  DATETIME NULL
);
GO

-- บิลเช่ากลับบ้าน
CREATE TABLE tbl_offsiterental (
    RentalID         INT IDENTITY(1,1) PRIMARY KEY,
    CustomerID       INT NOT NULL REFERENCES tbl_customer(CustomerID),
    GameID           INT NOT NULL REFERENCES tbl_boardgame(GameID),
    EmployeeID       INT NOT NULL REFERENCES tbl_employee(EmployeeID),
    RentalDate       DATETIME NOT NULL DEFAULT GETDATE(),
    DueDate          DATE NOT NULL,
    RentalFee        DECIMAL(10,2) NOT NULL,
    Deposit          DECIMAL(10,2) NOT NULL,
    Status           VARCHAR(20) NOT NULL DEFAULT 'Rented'
        CHECK (Status IN ('Rented','Returned','Overdue')),
    ReturnDate       DATETIME NULL,
    ReturnCondition  VARCHAR(100) NULL,      -- สภาพเกมตอนคืน (ปกติ/ชำรุด/ชิ้นส่วนหาย)
    DepositRefunded  DECIMAL(10,2) NULL
);
GO

/* =========================================================
   2. INDEX (WK08)
   ========================================================= */
CREATE INDEX IX_session_customer   ON tbl_session(CustomerID);
CREATE INDEX IX_session_table      ON tbl_session(TableID);
CREATE INDEX IX_rental_customer    ON tbl_offsiterental(CustomerID);
CREATE INDEX IX_rental_duedate     ON tbl_offsiterental(DueDate);
CREATE INDEX IX_instoreborrow_session ON tbl_instoreborrow(SessionID);
CREATE INDEX IX_queue_table_status ON tbl_queue(TableID, Status, QueueTime);
-- กฎ 1 โต๊ะ หยิบได้ครั้งละ 1 เกม (เกมที่ยังไม่คืนต่อ session ได้แค่ 1 แถว)
CREATE UNIQUE INDEX UX_instoreborrow_one_active_game ON tbl_instoreborrow(SessionID) WHERE ReturnTime IS NULL;
CREATE UNIQUE INDEX UX_employee_username ON tbl_employee(Username) WHERE Username IS NOT NULL;
-- เลขบัตร ปชช. ห้ามซ้ำ แต่ลูกค้าที่ยังไม่กรอก (NULL) มีได้หลายคน
-- (UNIQUE constraint ปกติของ SQL Server ยอมให้มี NULL ได้แค่แถวเดียว จึงใช้ filtered unique index แทน)
CREATE UNIQUE INDEX UX_customer_nationalid ON tbl_customer(NationalID) WHERE NationalID IS NOT NULL;
GO

/* =========================================================
   3. TRIGGERS — ควบคุมสต๊อกอัตโนมัติ (Data Integrity)
   ========================================================= */

-- หยิบเกมเข้าโต๊ะ (ในร้าน) -> ตัดสต๊อก
CREATE TRIGGER trg_instoreborrow_insert
ON tbl_instoreborrow
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE bg
    SET AvailableQty = bg.AvailableQty - i.Cnt
    FROM tbl_boardgame bg
    JOIN (SELECT GameID, COUNT(*) AS Cnt FROM inserted GROUP BY GameID) i
      ON bg.GameID = i.GameID;
END
GO

-- คืนเกมจากโต๊ะ (ReturnTime ถูกเซ็ตครั้งแรก) -> คืนสต๊อก
CREATE TRIGGER trg_instoreborrow_return
ON tbl_instoreborrow
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(ReturnTime)
    BEGIN
        UPDATE bg
        SET AvailableQty = bg.AvailableQty + r.Cnt
        FROM tbl_boardgame bg
        JOIN (
            SELECT i.GameID, COUNT(*) AS Cnt
            FROM inserted i
            JOIN deleted d ON i.BorrowID = d.BorrowID
            WHERE d.ReturnTime IS NULL AND i.ReturnTime IS NOT NULL
            GROUP BY i.GameID
        ) r ON bg.GameID = r.GameID;
    END
END
GO

-- เช่ากลับบ้าน -> ตัดสต๊อก
CREATE TRIGGER trg_offsiterental_insert
ON tbl_offsiterental
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE bg
    SET AvailableQty = bg.AvailableQty - i.Cnt
    FROM tbl_boardgame bg
    JOIN (SELECT GameID, COUNT(*) AS Cnt FROM inserted GROUP BY GameID) i
      ON bg.GameID = i.GameID;
END
GO

-- คืนเกม (เช่ากลับบ้าน) เมื่อ Status เปลี่ยนเป็น Returned -> คืนสต๊อก
CREATE TRIGGER trg_offsiterental_return
ON tbl_offsiterental
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(Status)
    BEGIN
        UPDATE bg
        SET AvailableQty = bg.AvailableQty + r.Cnt
        FROM tbl_boardgame bg
        JOIN (
            SELECT i.GameID, COUNT(*) AS Cnt
            FROM inserted i
            JOIN deleted d ON i.RentalID = d.RentalID
            WHERE d.Status <> 'Returned' AND i.Status = 'Returned'
            GROUP BY i.GameID
        ) r ON bg.GameID = r.GameID;
    END
END
GO

/* =========================================================
   4. FUNCTION (WK13)
   ========================================================= */
-- fn_RemainingMinutes: เวลาที่เหลือ (นาที) ของการจองโต๊ะที่ยังเล่นอยู่ — ใช้ใน vw_TableStatus และหน้า "สถานะของฉัน"
CREATE OR ALTER FUNCTION dbo.fn_RemainingMinutes(@SessionID INT)
RETURNS INT
AS
BEGIN
    DECLARE @Remain INT;
    SELECT @Remain = DATEDIFF(MINUTE, GETDATE(), ExpectedEndTime)
    FROM tbl_session
    WHERE SessionID = @SessionID AND Status = 'Active';
    RETURN @Remain;
END
GO

-- fn_WaitingQueueCount: จำนวนคิวที่รอโต๊ะนี้อยู่ — ใช้ตัดสินว่าจองได้ทันทีหรือต้องเข้าคิว (หน้า "จองโต๊ะ")
CREATE OR ALTER FUNCTION dbo.fn_WaitingQueueCount(@TableID INT)
RETURNS INT
AS
BEGIN
    RETURN (SELECT COUNT(*) FROM tbl_queue WHERE TableID = @TableID AND Status = 'Waiting');
END
GO

-- fn_RentalOverdueDays: เกินกำหนดคืนกี่วัน (คืนแล้ว/ยังไม่ถึงกำหนด = 0) — ใช้ใน vw_RentalDetail, หน้า "เช่ากลับบ้าน"
CREATE OR ALTER FUNCTION dbo.fn_RentalOverdueDays(@DueDate DATE, @Status VARCHAR(20))
RETURNS INT
AS
BEGIN
    IF @Status = 'Returned' OR @DueDate >= CAST(GETDATE() AS DATE)
        RETURN 0;
    RETURN DATEDIFF(DAY, @DueDate, CAST(GETDATE() AS DATE));
END
GO

/* =========================================================
   5. STORED PROCEDURES (WK14) — Business Logic หลัก
   ========================================================= */

-- 5.1 เปิดโต๊ะ + ชำระเงินล่วงหน้า
CREATE PROCEDURE sp_CheckIn
    @TableID INT, @PackageID INT, @CustomerID INT = NULL,
    @EmployeeID INT, @AmountPaid DECIMAL(10,2),
    @SessionID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_table WHERE TableID=@TableID AND Status='Available')
    BEGIN
        RAISERROR('โต๊ะนี้ไม่ว่าง', 16, 1); RETURN;
    END

    DECLARE @Duration INT;
    SELECT @Duration = DurationMinutes FROM tbl_timepackage WHERE PackageID=@PackageID;

    BEGIN TRAN;
        INSERT INTO tbl_session (TableID, CustomerID, PackageID, EmployeeID, StartTime, ExpectedEndTime, AmountPaid)
        VALUES (@TableID, @CustomerID, @PackageID, @EmployeeID, GETDATE(),
                DATEADD(MINUTE, ISNULL(@Duration, 600), GETDATE()), @AmountPaid);

        SET @SessionID = SCOPE_IDENTITY();

        UPDATE tbl_table SET Status='Occupied' WHERE TableID=@TableID;
    COMMIT;
END
GO

-- 5.2 หยิบบอร์ดเกมเข้าโต๊ะ (1 โต๊ะ หยิบได้ครั้งละ 1 เกม ต้องคืนก่อนหยิบเกมใหม่)
CREATE PROCEDURE sp_BorrowGameInStore
    @SessionID INT, @GameID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_session WHERE SessionID = @SessionID AND Status = 'Active')
    BEGIN
        RAISERROR(N'โต๊ะนี้ไม่ได้เปิดใช้งานอยู่', 16, 1); RETURN;
    END
    IF EXISTS (SELECT 1 FROM tbl_instoreborrow WHERE SessionID = @SessionID AND ReturnTime IS NULL)
    BEGIN
        RAISERROR(N'โต๊ะนี้มีเกมอยู่แล้ว ต้องคืนเกมเดิมก่อนถึงจะหยิบเกมใหม่ได้ (1 โต๊ะ 1 เกม)', 16, 1); RETURN;
    END
    IF ISNULL((SELECT AvailableQty FROM tbl_boardgame WHERE GameID = @GameID), 0) <= 0
    BEGIN
        RAISERROR(N'บอร์ดเกมนี้ไม่พอให้หยิบ', 16, 1); RETURN;
    END

    INSERT INTO tbl_instoreborrow (SessionID, GameID, BorrowTime)
    VALUES (@SessionID, @GameID, GETDATE());   -- trigger จะตัดสต๊อกให้อัตโนมัติ
END
GO

-- 5.3 เคลียร์โต๊ะ (Check-out)
CREATE PROCEDURE sp_CheckOut
    @SessionID INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TableID INT;
    SELECT @TableID = TableID FROM tbl_session WHERE SessionID=@SessionID;

    BEGIN TRAN;
        UPDATE tbl_instoreborrow
        SET ReturnTime = GETDATE()
        WHERE SessionID=@SessionID AND ReturnTime IS NULL;   -- trigger คืนสต๊อกอัตโนมัติ

        UPDATE tbl_session
        SET ActualEndTime = GETDATE(), Status='Completed'
        WHERE SessionID=@SessionID;

        UPDATE tbl_table SET Status='Available' WHERE TableID=@TableID;
    COMMIT;
END
GO

-- 5.4 ต่อเวลาอัจฉริยะ (Smart Extension)
CREATE PROCEDURE sp_ExtendTime
    @SessionID INT, @AdditionalMinutes INT, @AdditionalFee DECIMAL(10,2)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @FreeTables INT, @WaitingQueue INT;

    SELECT @FreeTables = COUNT(*) FROM tbl_table WHERE Status='Available';

    IF @FreeTables = 0
    BEGIN
        SELECT @WaitingQueue = COUNT(*) FROM tbl_queue WHERE Status='Waiting';
        IF @WaitingQueue > 0
        BEGIN
            RAISERROR('มีลูกค้ารอคิวอยู่ ไม่สามารถต่อเวลาได้ กรุณาเช็คเอาท์ตามเวลาเดิม และนำชื่อไปต่อท้ายคิวใหม่หากต้องการเล่นต่อ', 16, 1);
            RETURN;
        END
    END

    BEGIN TRAN;
        UPDATE tbl_session
        SET ExpectedEndTime = DATEADD(MINUTE, @AdditionalMinutes, ExpectedEndTime),
            AmountPaid = AmountPaid + @AdditionalFee
        WHERE SessionID=@SessionID AND Status='Active';

        INSERT INTO tbl_sessionextension (SessionID, ExtendedMinutes, AdditionalFee)
        VALUES (@SessionID, @AdditionalMinutes, @AdditionalFee);
    COMMIT;
END
GO

-- 5.5 เพิ่มชื่อเข้าคิว — ระบุโต๊ะที่รอได้ + ผูกกับลูกค้า
CREATE PROCEDURE sp_AddToQueue
    @CustomerName VARCHAR(100),
    @Phone        VARCHAR(15) = NULL,
    @TableID      INT = NULL,
    @QueueID      INT = NULL OUTPUT,
    @CustomerID   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @TableID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tbl_table WHERE TableID = @TableID)
    BEGIN
        RAISERROR(N'ไม่พบโต๊ะที่เลือก', 16, 1); RETURN;
    END

    INSERT INTO tbl_queue (CustomerName, Phone, QueueTime, Status, TableID, CustomerID)
    VALUES (@CustomerName, @Phone, GETDATE(), 'Waiting', @TableID, @CustomerID);

    SET @QueueID = SCOPE_IDENTITY();
END
GO

-- 5.6 เรียกคิวเข้านั่งเมื่อโต๊ะว่าง (คิวของโต๊ะนั้นก่อน → คิวรวม, FIFO) — บิลผูกกับลูกค้าของคิว
CREATE PROCEDURE sp_SeatNextInQueue
    @TableID INT, @PackageID INT, @EmployeeID INT, @AmountPaid DECIMAL(10,2),
    @SessionID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM tbl_table WHERE TableID = @TableID AND Status = 'Available')
    BEGIN
        RAISERROR(N'โต๊ะนี้ยังไม่ว่าง ต้องเช็คเอาท์ก่อนถึงจะเรียกคิวเข้านั่งได้', 16, 1); RETURN;
    END

    DECLARE @QueueID INT, @CustomerID INT;
    SELECT TOP 1 @QueueID = QueueID, @CustomerID = CustomerID
    FROM tbl_queue
    WHERE Status = 'Waiting' AND (TableID = @TableID OR TableID IS NULL)
    ORDER BY CASE WHEN TableID = @TableID THEN 0 ELSE 1 END, QueueTime ASC;

    IF @QueueID IS NULL
    BEGIN
        RAISERROR(N'ไม่มีลูกค้ารอคิวโต๊ะนี้', 16, 1); RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
            EXEC sp_CheckIn @TableID = @TableID, @PackageID = @PackageID, @CustomerID = @CustomerID,
                            @EmployeeID = @EmployeeID, @AmountPaid = @AmountPaid,
                            @SessionID = @SessionID OUTPUT;

            IF @SessionID IS NULL
                RAISERROR(N'เปิดโต๊ะไม่สำเร็จ', 16, 1);

            UPDATE tbl_queue SET Status = 'Seated' WHERE QueueID = @QueueID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- 5.6c พนักงานจองให้ลูกค้า: หาจากเบอร์ ไม่เจอสร้างใหม่
CREATE PROCEDURE sp_FindOrCreateCustomer
    @FirstName VARCHAR(50), @LastName VARCHAR(50), @Phone VARCHAR(15),
    @CustomerID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF LEN(LTRIM(RTRIM(ISNULL(@FirstName, '')))) = 0 OR LEN(LTRIM(RTRIM(ISNULL(@LastName, '')))) = 0
    BEGIN
        RAISERROR(N'ต้องระบุชื่อและนามสกุลลูกค้า', 16, 1); RETURN;
    END

    SELECT @CustomerID = CustomerID FROM tbl_customer WHERE Phone = @Phone;
    IF @CustomerID IS NULL
    BEGIN
        INSERT INTO tbl_customer (FirstName, LastName, Phone) VALUES (@FirstName, @LastName, @Phone);
        SET @CustomerID = SCOPE_IDENTITY();
    END
END
GO

-- 5.6d ลูกค้าสมัครสมาชิกบนเว็บ
CREATE PROCEDURE sp_RegisterCustomerAccount
    @FirstName VARCHAR(50), @LastName VARCHAR(50), @Phone VARCHAR(15), @PasswordHash VARCHAR(100),
    @CustomerID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ExistingHash VARCHAR(100);
    SELECT @CustomerID = CustomerID, @ExistingHash = PasswordHash FROM tbl_customer WHERE Phone = @Phone;

    IF @CustomerID IS NOT NULL AND @ExistingHash IS NOT NULL
    BEGIN
        SET @CustomerID = NULL;
        RAISERROR(N'เบอร์นี้สมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบ', 16, 1); RETURN;
    END

    IF @CustomerID IS NOT NULL
        -- เคยเป็นลูกค้าที่ร้าน (พนักงานบันทึกไว้) → ตั้งรหัสผ่านให้ ประวัติ/แต้มเดิมยังอยู่ครบ
        UPDATE tbl_customer SET PasswordHash = @PasswordHash, FirstName = @FirstName, LastName = @LastName
        WHERE CustomerID = @CustomerID;
    ELSE
    BEGIN
        INSERT INTO tbl_customer (FirstName, LastName, Phone, PasswordHash)
        VALUES (@FirstName, @LastName, @Phone, @PasswordHash);
        SET @CustomerID = SCOPE_IDENTITY();
    END
END
GO

-- 5.6b ยกเลิกคิว
CREATE PROCEDURE sp_CancelQueue
    @QueueID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_queue WHERE QueueID = @QueueID AND Status = 'Waiting')
    BEGIN
        RAISERROR(N'ไม่พบคิวนี้ หรือคิวถูกเรียก/ยกเลิกไปแล้ว', 16, 1); RETURN;
    END
    UPDATE tbl_queue SET Status = 'Cancelled' WHERE QueueID = @QueueID;
END
GO

-- 5.7 ลงทะเบียนลูกค้าเพื่อเช่ากลับบ้าน (บังคับเลขบัตร ปชช. 13 หลัก)
CREATE PROCEDURE sp_RegisterCustomerForRental
    @FirstName VARCHAR(50), @LastName VARCHAR(50), @Phone VARCHAR(15), @NationalID CHAR(13),
    @CustomerID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF LEN(@NationalID) <> 13 OR @NationalID LIKE '%[^0-9]%'
    BEGIN
        RAISERROR('เลขบัตรประจำตัวประชาชนต้องมี 13 หลักเท่านั้น', 16, 1); RETURN;
    END

    INSERT INTO tbl_customer (FirstName, LastName, Phone, NationalID)
    VALUES (@FirstName, @LastName, @Phone, @NationalID);

    SET @CustomerID = SCOPE_IDENTITY();
END
GO

-- 5.8 เช่าเกมกลับบ้าน
CREATE PROCEDURE sp_RentOffsite
    @CustomerID INT, @GameID INT, @EmployeeID INT, @DueDate DATE,
    @RentalID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_customer WHERE CustomerID=@CustomerID AND NationalID IS NOT NULL)
    BEGIN
        RAISERROR('ลูกค้าต้องลงทะเบียนและมีเลขบัตรประชาชนก่อนเช่ากลับบ้าน', 16, 1); RETURN;
    END
    IF (SELECT AvailableQty FROM tbl_boardgame WHERE GameID=@GameID) <= 0
    BEGIN
        RAISERROR('บอร์ดเกมนี้ไม่พอให้เช่า', 16, 1); RETURN;
    END

    DECLARE @Rate DECIMAL(10,2), @Deposit DECIMAL(10,2);
    SELECT @Rate=OffsiteRentalRate, @Deposit=DepositAmount FROM tbl_boardgame WHERE GameID=@GameID;

    INSERT INTO tbl_offsiterental (CustomerID, GameID, EmployeeID, RentalDate, DueDate, RentalFee, Deposit, Status)
    VALUES (@CustomerID, @GameID, @EmployeeID, GETDATE(), @DueDate, @Rate, @Deposit, 'Rented');
    -- trigger จะตัดสต๊อกให้อัตโนมัติ

    SET @RentalID = SCOPE_IDENTITY();
END
GO

-- 5.9 คืนเกม (เช่ากลับบ้าน)
CREATE PROCEDURE sp_ReturnOffsite
    @RentalID INT, @ReturnCondition VARCHAR(100) = 'ปกติ', @DepositRefunded DECIMAL(10,2)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Deposit DECIMAL(10,2);
    SELECT @Deposit = Deposit FROM tbl_offsiterental
    WHERE RentalID = @RentalID AND Status <> 'Returned';

    IF @Deposit IS NULL
    BEGIN
        RAISERROR(N'บิลนี้คืนเกมไปแล้ว หรือไม่พบบิล', 16, 1); RETURN;
    END
    IF @DepositRefunded < 0 OR @DepositRefunded > @Deposit
    BEGIN
        RAISERROR(N'ยอดคืนมัดจำต้องอยู่ระหว่าง 0 ถึงค่ามัดจำที่เก็บไว้', 16, 1); RETURN;
    END

    BEGIN TRAN;
        UPDATE tbl_offsiterental
        SET Status='Returned', ReturnDate=GETDATE(),
            ReturnCondition=@ReturnCondition, DepositRefunded=@DepositRefunded
        WHERE RentalID=@RentalID;
        -- trigger จะคืนสต๊อกให้อัตโนมัติ

        -- สะสมแต้ม: ลูกค้าที่เช่ากลับบ้าน ได้แต้ม = ค่าเช่า/10
        UPDATE c
        SET Points = c.Points + FLOOR(r.RentalFee/10)
        FROM tbl_customer c
        JOIN tbl_offsiterental r ON c.CustomerID = r.CustomerID
        WHERE r.RentalID=@RentalID;
    COMMIT;
END
GO

/* =========================================================
   6. VIEWS — รายงาน/สถานะที่ใช้บ่อย
   ========================================================= */

-- vw_TableStatus: สถานะโต๊ะทุกตัว + ลูกค้าที่นั่ง + เวลาที่เหลือ + จำนวนคิวรอ — หน้า "สถานะโต๊ะ" / ฟอร์มจองโต๊ะ (เรียลไทม์)
CREATE OR ALTER VIEW vw_TableStatus AS
SELECT t.TableID, t.Zone, t.Capacity, t.HourlyRate, t.Status,
       s.SessionID, s.StartTime, s.ExpectedEndTime,
       dbo.fn_RemainingMinutes(s.SessionID) AS MinutesLeft,
       CASE WHEN c.CustomerID IS NULL THEN NULL ELSE CONCAT(c.FirstName, ' ', c.LastName) END AS CustomerName,
       c.Phone AS CustomerPhone,
       dbo.fn_WaitingQueueCount(t.TableID) AS WaitingCount
FROM tbl_table t
LEFT JOIN tbl_session s  ON t.TableID = s.TableID AND s.Status = 'Active'
LEFT JOIN tbl_customer c ON s.CustomerID = c.CustomerID;
GO

-- vw_CurrentQueue: คิวที่ยังรออยู่ + รอมาแล้วกี่นาที — ส่วน "คิวรอโต๊ะ" ในหน้าสถานะโต๊ะ
CREATE OR ALTER VIEW vw_CurrentQueue AS
SELECT QueueID, TableID, CustomerID, CustomerName, Phone, QueueTime,
       DATEDIFF(MINUTE, QueueTime, GETDATE()) AS WaitedMinutes
FROM tbl_queue
WHERE Status = 'Waiting';
GO

-- vw_AvailableGames: เกมที่ยังมีของว่าง
CREATE OR ALTER VIEW vw_AvailableGames AS
SELECT GameID, Name, AvailableQty, TotalQty, OffsiteRentalRate
FROM tbl_boardgame
WHERE AvailableQty > 0;
GO

-- vw_RentalDetail: บิลเช่ากลับบ้านพร้อมชื่อลูกค้า/เกม และจำนวนวันที่เกินกำหนด — หน้า "เช่ากลับบ้าน" และ "บัญชีของฉัน"
CREATE OR ALTER VIEW vw_RentalDetail AS
SELECT r.RentalID, r.CustomerID, c.FirstName, c.LastName, c.Phone,
       r.GameID, g.Name AS GameName, r.RentalDate, r.DueDate, r.RentalFee, r.Deposit,
       r.Status, r.ReturnDate, r.ReturnCondition, r.DepositRefunded,
       dbo.fn_RentalOverdueDays(r.DueDate, r.Status) AS OverdueDays,
       CASE WHEN dbo.fn_RentalOverdueDays(r.DueDate, r.Status) > 0 THEN 1 ELSE 0 END AS IsOverdue
FROM tbl_offsiterental r
JOIN tbl_customer c  ON r.CustomerID = c.CustomerID
JOIN tbl_boardgame g ON r.GameID = g.GameID;
GO

-- vw_OverdueRentals: เฉพาะบิลที่เกินกำหนดคืน (ใช้ตามทวงเกม)
CREATE OR ALTER VIEW vw_OverdueRentals AS
SELECT RentalID, FirstName, LastName, Phone, GameName, DueDate, OverdueDays
FROM vw_RentalDetail
WHERE OverdueDays > 0;
GO

-- vw_DailyRevenue: รายได้รวมรายวัน (ค่าโต๊ะ + ค่าเช่ากลับบ้าน) — หน้า "รายได้"
CREATE OR ALTER VIEW vw_DailyRevenue AS
SELECT CAST(d.RevDate AS DATE) AS RevenueDate, SUM(d.Amount) AS TotalRevenue
FROM (
    SELECT StartTime AS RevDate, AmountPaid AS Amount FROM tbl_session
    UNION ALL
    SELECT RentalDate AS RevDate, RentalFee AS Amount FROM tbl_offsiterental
) d
GROUP BY CAST(d.RevDate AS DATE);
GO

/* =========================================================
   7. ข้อมูลตัวอย่าง
   ========================================================= */
INSERT INTO tbl_gamecategory (CategoryName) VALUES ('Strategy'),('Party'),('Family'),('Card Game');

INSERT INTO tbl_boardgame (Name, CategoryID, MinPlayer, MaxPlayer, Difficulty, TotalQty, AvailableQty, OffsiteRentalRate, DepositAmount) VALUES
('Catan', 1, 3, 4, 'Medium', 2, 2, 100, 500),
('Codenames', 2, 4, 8, 'Easy', 3, 3, 80, 300),
('Ticket to Ride', 1, 2, 5, 'Medium', 2, 2, 100, 500),
('Uno', 4, 2, 10, 'Easy', 5, 5, 40, 100),
('Carcassonne', 3, 2, 5, 'Easy', 2, 2, 90, 400);

INSERT INTO tbl_table (Zone, Capacity, HourlyRate, Status) VALUES
('A', 4, 50, 'Available'), ('A', 6, 70, 'Available'),
('B', 2, 40, 'Available'), ('B', 8, 100, 'Available'),
('VIP', 6, 150, 'Available');

INSERT INTO tbl_timepackage (PackageName, DurationMinutes, Price) VALUES
('1 ชั่วโมง', 60, 60), ('2 ชั่วโมง', 120, 110), ('เหมาวัน', NULL, 300);

-- บัญชีแอดมินเริ่มต้น: somchai / admin1234, suda / admin1234 (bcrypt hash) + พนักงานระบบสำหรับจองออนไลน์
INSERT INTO tbl_employee (Name, Position, Phone, Username, PasswordHash) VALUES
('Somchai', 'Staff', '0811111111', 'somchai', '$2a$10$yIP7OpGQNxfMn8Jrh35xVOkUpc8RIIdTjeVDZGJJhj0.PU.oNlLsC'),
('Suda', 'Manager', '0822222222', 'suda', '$2a$10$yIP7OpGQNxfMn8Jrh35xVOkUpc8RIIdTjeVDZGJJhj0.PU.oNlLsC'),
('Online Booking', 'System', NULL, NULL, NULL);
GO

-- รายละเอียดเกม + วิธีเล่นแบบย่อ
/* ใส่ข้อมูลให้เกมตัวอย่าง — COALESCE: ถ้าเคยแก้ข้อความเองแล้ว รันซ้ำจะไม่ทับ */
UPDATE dbo.tbl_boardgame SET
    ImageUrl = COALESCE(ImageUrl, '/images/games/catan.svg'),
    PlayTime = COALESCE(PlayTime, N'60-90 นาที'),
    ShortDescription = COALESCE(ShortDescription, N'เกมวางแผนสร้างอาณานิคมบนเกาะ เก็บทรัพยากร (ไม้ อิฐ แกะ ข้าวสาลี แร่) มาสร้างถนน หมู่บ้าน และเมือง ต้องเจรจาแลกเปลี่ยนกับผู้เล่นอื่นให้เก่ง'),
    HowToPlay = COALESCE(HowToPlay, N'เริ่มเกมแต่ละคนวางหมู่บ้าน 2 หลังและถนน 2 เส้นบนแผนที่ช่องหกเหลี่ยม
ตาของเรา ทอยลูกเต๋า 2 ลูก ช่องที่มีเลขตรงกับแต้มจะให้ทรัพยากรกับหมู่บ้าน/เมืองที่อยู่ติดช่องนั้น (ได้ทุกคน)
แลกทรัพยากรกับผู้เล่นอื่น หรือแลกกับธนาคาร 4 ใบต่อ 1 ใบ
ใช้ทรัพยากรสร้างถนน หมู่บ้าน อัปเกรดเป็นเมือง หรือซื้อการ์ดพัฒนา
ทอยได้ 7 ให้ย้ายโจร และใครถือการ์ดเกิน 7 ใบต้องทิ้งครึ่งหนึ่ง
ใครได้ 10 แต้มชัยชนะก่อนเป็นผู้ชนะ (หมู่บ้าน 1 แต้ม เมือง 2 แต้ม)')
WHERE Name = 'Catan';

UPDATE dbo.tbl_boardgame SET
    ImageUrl = COALESCE(ImageUrl, '/images/games/codenames.svg'),
    PlayTime = COALESCE(PlayTime, N'15-20 นาที'),
    ShortDescription = COALESCE(ShortDescription, N'เกมปาร์ตี้ทายคำแบบแบ่ง 2 ทีม หัวหน้าสายลับต้องใบ้ด้วยคำเดียวให้เพื่อนร่วมทีมเดาคำลับของทีมตัวเองให้ครบก่อนอีกทีม'),
    HowToPlay = COALESCE(HowToPlay, N'แบ่ง 2 ทีม (แดง / น้ำเงิน) แต่ละทีมเลือกหัวหน้าสายลับ 1 คน
วางการ์ดคำ 25 ใบเป็นตาราง 5×5 มีแค่หัวหน้าที่เห็นการ์ดเฉลยว่าคำไหนเป็นของทีมไหน
หัวหน้าใบ้ "1 คำ + 1 ตัวเลข" เช่น "ผลไม้ 2" แปลว่ามีคำเกี่ยวกับผลไม้ 2 คำ
ทีมเลือกทายทีละคำ ทายได้ไม่เกินจำนวนที่ใบ้ +1 ถ้าทายผิดจบตาทันที
ถ้าเปิดเจอการ์ด "นักฆ่า" ทีมนั้นแพ้ทันที
ทีมที่เปิดคำของตัวเองครบก่อนเป็นผู้ชนะ')
WHERE Name = 'Codenames';

UPDATE dbo.tbl_boardgame SET
    ImageUrl = COALESCE(ImageUrl, '/images/games/ticket-to-ride.svg'),
    PlayTime = COALESCE(PlayTime, N'30-60 นาที'),
    ShortDescription = COALESCE(ShortDescription, N'เกมสะสมการ์ดรถไฟเพื่อยึดเส้นทางเชื่อมเมือง และทำภารกิจเชื่อมเมืองตามตั๋วปลายทางให้สำเร็จ กติกาง่าย เหมาะกับมือใหม่'),
    HowToPlay = COALESCE(HowToPlay, N'เริ่มเกมได้การ์ดรถไฟ 4 ใบ และเลือกเก็บตั๋วปลายทางอย่างน้อย 2 ใบ
ตาของเราเลือกทำ 1 อย่าง: จั่วการ์ดรถไฟ 2 ใบ / ยึดเส้นทาง / จั่วตั๋วปลายทางเพิ่ม
ยึดเส้นทางโดยลงการ์ดสีเดียวกับเส้นทางให้ครบจำนวนช่อง แล้ววางตัวรถไฟ เส้นยิ่งยาวยิ่งได้แต้มมาก
เมื่อมีคนเหลือตัวรถไฟไม่เกิน 2 ตัว ทุกคนเล่นได้อีกคนละ 1 ตาแล้วจบเกม
ตั๋วที่เชื่อมสำเร็จได้แต้มบวก ตั๋วที่ไม่สำเร็จติดลบ แต้มรวมมากสุดชนะ')
WHERE Name = 'Ticket to Ride';

UPDATE dbo.tbl_boardgame SET
    ImageUrl = COALESCE(ImageUrl, '/images/games/uno.svg'),
    PlayTime = COALESCE(PlayTime, N'15-30 นาที'),
    ShortDescription = COALESCE(ShortDescription, N'เกมไพ่ครอบครัวยอดนิยม ลงไพ่ให้ตรงสีหรือตัวเลขกับกองกลาง ใครลงไพ่หมดมือก่อนชนะ เล่นง่าย สนุกได้ทุกวัย'),
    HowToPlay = COALESCE(HowToPlay, N'แจกไพ่คนละ 7 ใบ แล้วเปิดไพ่ใบบนสุดตั้งเป็นกองกลาง
ลงไพ่ที่สีเดียวกัน หรือเลข/สัญลักษณ์เดียวกับไพ่ใบบนสุด
ไพ่พิเศษ: ข้าม (Skip), กลับทิศ (Reverse), +2, เปลี่ยนสี (Wild) และ +4 เปลี่ยนสี
ถ้าไม่มีไพ่ที่ลงได้ ต้องจั่ว 1 ใบ
เหลือไพ่ 1 ใบต้องพูดว่า "อูโน่!" ถ้าลืมแล้วโดนจับได้ต้องจั่วเพิ่ม 2 ใบ
ใครลงไพ่หมดมือก่อนชนะรอบนั้น')
WHERE Name = 'Uno';

UPDATE dbo.tbl_boardgame SET
    ImageUrl = COALESCE(ImageUrl, '/images/games/carcassonne.svg'),
    PlayTime = COALESCE(PlayTime, N'30-45 นาที'),
    ShortDescription = COALESCE(ShortDescription, N'เกมต่อแผ่นภาพสร้างเมืองยุคกลาง วางแผ่นต่อถนน เมือง และโบสถ์ แล้ววางคนงานยึดพื้นที่เพื่อเก็บแต้ม'),
    HowToPlay = COALESCE(HowToPlay, N'ตาของเราจั่วแผ่นภาพ 1 แผ่น แล้ววางต่อกับแผ่นบนโต๊ะ ขอบต้องเข้ากัน (ถนนต่อถนน เมืองต่อเมือง)
เลือกวางคนงานของเรา 1 ตัวบนแผ่นที่เพิ่งวาง (ถนน เมือง โบสถ์ หรือทุ่งหญ้า) ถ้าส่วนนั้นยังไม่มีใครยึด
ถนน เมือง หรือโบสถ์ที่สร้างเสร็จคิดแต้มทันที แล้วได้คนงานคืน
เมื่อแผ่นภาพหมด คิดแต้มส่วนที่ยังสร้างไม่เสร็จและทุ่งหญ้า
แต้มรวมมากสุดชนะ')
WHERE Name = 'Carcassonne';
GO

/* =========================================================
   8. ADMIN — ลบข้อมูลจากหน้าเว็บแบบ cascade (v5)
   ========================================================= */
/* ---------------------------------------------------------
   8.1 TRIGGERS ตอนลบ — ลบแถวจากหน้าเว็บ (หรือ SSMS) แล้วสต๊อก/สถานะโต๊ะยังถูกต้อง
   --------------------------------------------------------- */

-- ลบรายการหยิบเกมที่ยังไม่คืน -> คืนสต๊อกให้เกมนั้น (ไม่เกิน TotalQty)
CREATE OR ALTER TRIGGER trg_instoreborrow_delete
ON tbl_instoreborrow
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE bg
    SET AvailableQty = CASE WHEN bg.AvailableQty + d.Cnt > bg.TotalQty THEN bg.TotalQty
                            ELSE bg.AvailableQty + d.Cnt END
    FROM tbl_boardgame bg
    JOIN (SELECT GameID, COUNT(*) AS Cnt FROM deleted WHERE ReturnTime IS NULL GROUP BY GameID) d
      ON bg.GameID = d.GameID;
END
GO

-- ลบบิลเช่ากลับบ้านที่ยังไม่คืน -> คืนสต๊อก
CREATE OR ALTER TRIGGER trg_offsiterental_delete
ON tbl_offsiterental
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE bg
    SET AvailableQty = CASE WHEN bg.AvailableQty + d.Cnt > bg.TotalQty THEN bg.TotalQty
                            ELSE bg.AvailableQty + d.Cnt END
    FROM tbl_boardgame bg
    JOIN (SELECT GameID, COUNT(*) AS Cnt FROM deleted WHERE Status <> 'Returned' GROUP BY GameID) d
      ON bg.GameID = d.GameID;
END
GO

-- ลบการจองโต๊ะที่ยัง Active -> โต๊ะกลับเป็น "ว่าง" (ถ้าไม่มี session อื่นใช้โต๊ะนั้นอยู่)
CREATE OR ALTER TRIGGER trg_session_delete
ON tbl_session
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE t
    SET Status = 'Available'
    FROM tbl_table t
    WHERE t.TableID IN (SELECT TableID FROM deleted WHERE Status = 'Active')
      AND NOT EXISTS (SELECT 1 FROM tbl_session s WHERE s.TableID = t.TableID AND s.Status = 'Active');
END
GO

/* ---------------------------------------------------------
   8.2 STORED PROCEDURES ลบแบบ cascade (ลบข้อมูลที่ผูกอยู่ด้วย ใน transaction เดียว)
   ลำดับการลบ: ลูก (ต่อเวลา/หยิบเกม) -> session -> บิลเช่า/คิว -> แถวหลัก
   ถ้าขั้นไหนพัง ROLLBACK ทั้งหมด (ข้อมูลไม่ค้างครึ่งๆ กลางๆ)
   --------------------------------------------------------- */

-- การจองโต๊ะ 1 รายการ (+ ต่อเวลา + เกมที่หยิบ)
CREATE OR ALTER PROCEDURE sp_AdminDeleteSession
    @SessionID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_session WHERE SessionID = @SessionID)
    BEGIN RAISERROR(N'ไม่พบการจองโต๊ะนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE FROM tbl_sessionextension WHERE SessionID = @SessionID;
            DELETE FROM tbl_instoreborrow    WHERE SessionID = @SessionID;   -- trigger คืนสต๊อก
            DELETE FROM tbl_session          WHERE SessionID = @SessionID;   -- trigger ปลดโต๊ะ
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- ลูกค้า (+ การจองโต๊ะทั้งหมด + บิลเช่า + คิว)
CREATE OR ALTER PROCEDURE sp_AdminDeleteCustomer
    @CustomerID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_customer WHERE CustomerID = @CustomerID)
    BEGIN RAISERROR(N'ไม่พบลูกค้านี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE e FROM tbl_sessionextension e JOIN tbl_session s ON s.SessionID = e.SessionID WHERE s.CustomerID = @CustomerID;
            DELETE b FROM tbl_instoreborrow b    JOIN tbl_session s ON s.SessionID = b.SessionID WHERE s.CustomerID = @CustomerID;
            DELETE FROM tbl_session       WHERE CustomerID = @CustomerID;
            DELETE FROM tbl_offsiterental WHERE CustomerID = @CustomerID;
            DELETE FROM tbl_queue         WHERE CustomerID = @CustomerID;
            DELETE FROM tbl_customer      WHERE CustomerID = @CustomerID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- พนักงาน (+ บิลโต๊ะ/บิลเช่าที่พนักงานคนนี้บันทึก) — ห้ามลบพนักงานระบบ Online Booking
CREATE OR ALTER PROCEDURE sp_AdminDeleteEmployee
    @EmployeeID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_employee WHERE EmployeeID = @EmployeeID)
    BEGIN RAISERROR(N'ไม่พบพนักงานนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM tbl_employee WHERE EmployeeID = @EmployeeID AND Position = 'System')
    BEGIN RAISERROR(N'ลบพนักงานระบบ Online Booking ไม่ได้ — ใช้บันทึกการจองที่ลูกค้าทำเองผ่านเว็บ', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE e FROM tbl_sessionextension e JOIN tbl_session s ON s.SessionID = e.SessionID WHERE s.EmployeeID = @EmployeeID;
            DELETE b FROM tbl_instoreborrow b    JOIN tbl_session s ON s.SessionID = b.SessionID WHERE s.EmployeeID = @EmployeeID;
            DELETE FROM tbl_session       WHERE EmployeeID = @EmployeeID;
            DELETE FROM tbl_offsiterental WHERE EmployeeID = @EmployeeID;
            DELETE FROM tbl_employee      WHERE EmployeeID = @EmployeeID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- หมวดเกม — เกมในหมวดนี้ไม่ถูกลบ แค่กลายเป็น "ไม่มีหมวด" (CategoryID = NULL)
CREATE OR ALTER PROCEDURE sp_AdminDeleteCategory
    @CategoryID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_gamecategory WHERE CategoryID = @CategoryID)
    BEGIN RAISERROR(N'ไม่พบหมวดนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            UPDATE tbl_boardgame SET CategoryID = NULL WHERE CategoryID = @CategoryID;
            DELETE FROM tbl_gamecategory WHERE CategoryID = @CategoryID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- บอร์ดเกม (+ ประวัติการหยิบเข้าโต๊ะ + บิลเช่ากลับบ้านของเกมนี้)
CREATE OR ALTER PROCEDURE sp_AdminDeleteGame
    @GameID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_boardgame WHERE GameID = @GameID)
    BEGIN RAISERROR(N'ไม่พบบอร์ดเกมนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE FROM tbl_instoreborrow WHERE GameID = @GameID;
            DELETE FROM tbl_offsiterental WHERE GameID = @GameID;
            DELETE FROM tbl_boardgame     WHERE GameID = @GameID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- โต๊ะ (+ การจองโต๊ะนี้ทั้งหมด + คิวรอโต๊ะนี้)
CREATE OR ALTER PROCEDURE sp_AdminDeleteTable
    @TableID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_table WHERE TableID = @TableID)
    BEGIN RAISERROR(N'ไม่พบโต๊ะนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE e FROM tbl_sessionextension e JOIN tbl_session s ON s.SessionID = e.SessionID WHERE s.TableID = @TableID;
            DELETE b FROM tbl_instoreborrow b    JOIN tbl_session s ON s.SessionID = b.SessionID WHERE s.TableID = @TableID;
            DELETE FROM tbl_session WHERE TableID = @TableID;
            DELETE FROM tbl_queue   WHERE TableID = @TableID;
            DELETE FROM tbl_table   WHERE TableID = @TableID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- แพ็กเกจเวลา (+ การจองโต๊ะที่ใช้แพ็กเกจนี้)
CREATE OR ALTER PROCEDURE sp_AdminDeletePackage
    @PackageID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_timepackage WHERE PackageID = @PackageID)
    BEGIN RAISERROR(N'ไม่พบแพ็กเกจนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
            DELETE e FROM tbl_sessionextension e JOIN tbl_session s ON s.SessionID = e.SessionID WHERE s.PackageID = @PackageID;
            DELETE b FROM tbl_instoreborrow b    JOIN tbl_session s ON s.SessionID = b.SessionID WHERE s.PackageID = @PackageID;
            DELETE FROM tbl_session     WHERE PackageID = @PackageID;
            DELETE FROM tbl_timepackage WHERE PackageID = @PackageID;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- คิว 1 รายการ
CREATE OR ALTER PROCEDURE sp_AdminDeleteQueue
    @QueueID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_queue WHERE QueueID = @QueueID)
    BEGIN RAISERROR(N'ไม่พบคิวนี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END
    DELETE FROM tbl_queue WHERE QueueID = @QueueID;
END
GO

-- บิลเช่ากลับบ้าน 1 รายการ (ถ้ายังไม่คืน trigger คืนสต๊อกให้)
CREATE OR ALTER PROCEDURE sp_AdminDeleteRental
    @RentalID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM tbl_offsiterental WHERE RentalID = @RentalID)
    BEGIN RAISERROR(N'ไม่พบบิลเช่านี้ (อาจถูกลบไปแล้ว)', 16, 1); RETURN; END
    DELETE FROM tbl_offsiterental WHERE RentalID = @RentalID;
END
GO

/* ---------------------------------------------------------
   8.3 แก้ฐานข้อมูลเดิม: เลขบัตร ปชช. ว่าง (NULL) ได้หลายคน
   ฐานที่สร้างจากไฟล์รุ่นเก่ามี UNIQUE constraint บน NationalID → เพิ่มลูกค้าที่ไม่กรอกเลขบัตรได้แค่คนเดียว
   batch นี้เปลี่ยนเป็น filtered unique index (รันซ้ำได้ ไม่ลบข้อมูล — เว็บรันให้เองตอนเปิด)
   --------------------------------------------------------- */
-- @auto-upgrade
DECLARE @uq sysname, @cmd nvarchar(400);
SELECT @uq = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.tbl_customer') AND kc.type = 'UQ' AND c.name = 'NationalID';
IF @uq IS NOT NULL
BEGIN
    SET @cmd = N'ALTER TABLE dbo.tbl_customer DROP CONSTRAINT ' + QUOTENAME(@uq);
    EXEC sp_executesql @cmd;
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_customer_nationalid' AND object_id = OBJECT_ID('dbo.tbl_customer'))
    CREATE UNIQUE INDEX UX_customer_nationalid ON dbo.tbl_customer(NationalID) WHERE NationalID IS NOT NULL;
GO
