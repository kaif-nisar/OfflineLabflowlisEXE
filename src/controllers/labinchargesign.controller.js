import fsPromises from "fs/promises";
import path from "path";
import {
    storeLocalFile,
    deleteLocalFile,
    doesLocalFileExist,
    normalizeStoredUploadUrl,
    resolveLocalStoredFilePath,
} from "../utils/localStorage.js";
import { doctorsign } from '../models/labinchargesign.model.js';

const getMimeTypeFromFileName = (fileName) => {
    const ext = path.extname(fileName || "").toLowerCase();
    switch (ext) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".svg":
            return "image/svg+xml";
        case ".gif":
            return "image/gif";
        default:
            return "image/png";
    }
};

const convertFileToBase64 = async (filePath, mimeType) => {
    try {
        if (!filePath) return "";
        const buffer = await fsPromises.readFile(filePath);
        const mime = mimeType || getMimeTypeFromFileName(filePath);
        return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (error) {
        console.error("Error converting signature file to base64:", error);
        return "";
    }
};

const normalizeSignatureAsset = async (urlValue, publicIdValue) => {
    const normalizedUrl = normalizeStoredUploadUrl(urlValue);
    const normalizedPublicId = normalizedUrl
        ? normalizedUrl.replace(/^\/uploads\//, "")
        : String(publicIdValue || "").trim().replace(/^\/?uploads\//, "");
    const fileExists = await doesLocalFileExist(normalizedPublicId || normalizedUrl);

    if (!normalizedUrl || !fileExists) {
        return {
            url: "",
            publicId: "",
            isValid: false,
        };
    }

    return {
        url: normalizedUrl,
        publicId: normalizedPublicId,
        isValid: true,
    };
};

// Image Upload Controller
const uploadDoctorsSign = async (req, res) => {
    const { showlab, showdoctorfirst, showdoctorsecond, labinchargeinfo, leftdoctorinfo, rightdoctorinfo } = req.body;
    const { labsign, firstdoctorsign, seconddoctorsign } = req.files || {};
    const userId = req.user._id;
    const tenantId = req.user.tenantId;

    try {

        let labsignresult = labsign?.[0]
            ? await storeLocalFile(labsign[0].path, {
                category: "signatures",
                fileName: labsign[0].originalname,
            })
            : null;
        let firstdoctorsignresult = firstdoctorsign?.[0]
            ? await storeLocalFile(firstdoctorsign[0].path, {
                category: "signatures",
                fileName: firstdoctorsign[0].originalname,
            })
            : null;
        let seconddoctorsignresult = seconddoctorsign?.[0]
            ? await storeLocalFile(seconddoctorsign[0].path, {
                category: "signatures",
                fileName: seconddoctorsign[0].originalname,
            })
            : null;

        const updatedata = {
            tenantId: tenantId._id,
            createdBy: userId,
            showlabinchargesign: showlab,
            labinchargeinfo: labinchargeinfo,
            showfirstdoctorsign: showdoctorfirst,
            firstdoctorsigninfo: leftdoctorinfo,
            showseconddoctorsign: showdoctorsecond,
            seconddoctorsigninfo: rightdoctorinfo
        }

        if (labsignresult && labsign?.[0]?.path) {
            updatedata.labinchargesign = labsignresult.secure_url;
            updatedata.labinchargesignpublicid = labsignresult.public_id;
            updatedata.labinchargesignInBase64 = await convertFileToBase64(labsign[0].path, labsign[0].mimetype);
        }

        if (firstdoctorsignresult && firstdoctorsign?.[0]?.path) {
            updatedata.firstdoctorsign = firstdoctorsignresult.secure_url;
            updatedata.firstdoctorsignpublicid = firstdoctorsignresult.public_id;
            updatedata.firstdoctorsignInBase64 = await convertFileToBase64(firstdoctorsign[0].path, firstdoctorsign[0].mimetype);
        }

        if (seconddoctorsignresult && seconddoctorsign?.[0]?.path) {
            updatedata.seconddoctorsign = seconddoctorsignresult.secure_url;
            updatedata.seconddoctorsignpublicid = seconddoctorsignresult.public_id;
            updatedata.seconddoctorsignInBase64 = await convertFileToBase64(seconddoctorsign[0].path, seconddoctorsign[0].mimetype);
        }

        const templateData = await doctorsign.findOneAndUpdate(
            {
                tenantId: tenantId._id,
                createdBy: userId
            },
            {
                $set: updatedata
            },
            {
                returnDocument: 'after',    // Return the updated document after the update
                upsert: true, // Create a new document if none matches the filter
            }
        );

        if (!templateData) {
            return res.status(500).json({ message: 'Failed to save in database' });
        }
        // Respond with success
        res.status(201).json({ message: 'changed saved successfully', data: templateData });

    } catch (error) {
        console.error('❌ Error uploading image:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({ 
            message: 'Server error during file upload',
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

const getDoctorsSign = async (req, res) => {
    const tenantId = req.user.tenantId._id;

    try {
        const labsigndata = await doctorsign.findOne({
            tenantId: tenantId,
        });

        if (!labsigndata) {
            return res.status(404).json({ message: 'No doctor signature found' });
        }

        let needsSave = false;

        if (!labsigndata.labinchargesignInBase64 && labsigndata.labinchargesign) {
            const path1 = resolveLocalStoredFilePath(labsigndata.labinchargesignpublicid || labsigndata.labinchargesign);
            if (path1) {
                const b64 = await convertFileToBase64(path1);
                if (b64) {
                    labsigndata.labinchargesignInBase64 = b64;
                    needsSave = true;
                }
            }
        }

        if (!labsigndata.firstdoctorsignInBase64 && labsigndata.firstdoctorsign) {
            const path2 = resolveLocalStoredFilePath(labsigndata.firstdoctorsignpublicid || labsigndata.firstdoctorsign);
            if (path2) {
                const b64 = await convertFileToBase64(path2);
                if (b64) {
                    labsigndata.firstdoctorsignInBase64 = b64;
                    needsSave = true;
                }
            }
        }

        if (!labsigndata.seconddoctorsignInBase64 && labsigndata.seconddoctorsign) {
            const path3 = resolveLocalStoredFilePath(labsigndata.seconddoctorsignpublicid || labsigndata.seconddoctorsign);
            if (path3) {
                const b64 = await convertFileToBase64(path3);
                if (b64) {
                    labsigndata.seconddoctorsignInBase64 = b64;
                    needsSave = true;
                }
            }
        }

        if (needsSave) {
            await labsigndata.save();
        }

        const labSignature = await normalizeSignatureAsset(
            labsigndata.labinchargesign,
            labsigndata.labinchargesignpublicid
        );
        const firstDoctorSignature = await normalizeSignatureAsset(
            labsigndata.firstdoctorsign,
            labsigndata.firstdoctorsignpublicid
        );
        const secondDoctorSignature = await normalizeSignatureAsset(
            labsigndata.seconddoctorsign,
            labsigndata.seconddoctorsignpublicid
        );

        const responsePayload = labsigndata.toObject();
        responsePayload.labinchargesign = labSignature.url;
        responsePayload.labinchargesignpublicid = labSignature.publicId;
        responsePayload.firstdoctorsign = firstDoctorSignature.url;
        responsePayload.firstdoctorsignpublicid = firstDoctorSignature.publicId;
        responsePayload.seconddoctorsign = secondDoctorSignature.url;
        responsePayload.seconddoctorsignpublicid = secondDoctorSignature.publicId;

        res.status(200).json(responsePayload);
    } catch (error) {
        console.error('Error fetching doctor signature:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const editdoctorsvisibility = async (req, res) => {
    try {
        const { showlab, showfirstdoctor, showseconddoctor } = req.body;
        const tenantId = req.user?.tenantId?._id;
        const userId = req.user?._id;

        // 1️⃣ Input validation
        if (
            typeof showlab !== 'boolean' ||
            typeof showfirstdoctor !== 'boolean' ||
            typeof showseconddoctor !== 'boolean'
        ) {
            return res.status(400).json({ message: 'Invalid input types. All fields must be boolean.' });
        }

        // 2️⃣ Ensure user & tenant exist
        if (!tenantId || !userId) {
            return res.status(401).json({ message: 'Unauthorized or missing user info' });
        }

        // 3️⃣ Perform update
        const editeddoc = await doctorsign.findOneAndUpdate(
            { tenantId: tenantId, createdBy: userId },
            {
                $set: {
                    showlabinchargesign: showlab,
                    showfirstdoctorsign: showfirstdoctor,
                    showseconddoctorsign: showseconddoctor
                }
            },
            { returnDocument: 'after' }
        );

        // 4️⃣ Document not found
        if (!editeddoc) {
            return res.status(404).json({ message: 'Signature record not found or not updated.' });
        }

        // 5️⃣ Success response
        return res.status(200).json({ message: 'Signature updated successfully' });

    } catch (error) {
        console.error('Error updating signature visibility:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const deleteLabInchargeSign = async (req, res) => {
    try {
        const { publicId, publicIdfield, urlfield } = req.body; // The image URL is passed in the request body
        const tenantId = req.user.tenantId._id;
        const userId = req.user._id;

        const deleteResponse = await deleteLocalFile(publicId);

        if (!deleteResponse || !["ok", "not found"].includes(deleteResponse.result)) {
            return res.status(500).json({ message: 'Failed to delete stored signature' });
        }

        const base64FieldMap = {
            "labinchargesign": "labinchargesignInBase64",
            "firstdoctorsign": "firstdoctorsignInBase64",
            "seconddoctorsign": "seconddoctorsignInBase64"
        };
        const base64FieldToClear = base64FieldMap[urlfield];

        const setFields = {
            [publicIdfield]: "",
            [urlfield]: ""
        };
        if (base64FieldToClear) {
            setFields[base64FieldToClear] = "";
        }

        const templateData = await doctorsign.findOneAndUpdate(
            {
                tenantId: tenantId,
                createdBy: userId
            },
            {
                $set: setFields
            },
            {
                returnDocument: 'after',    // Return the updated document after the update
                upsert: true, // Create a new document if none matches the filter
            }
        );

        if (!templateData) {
            return res.status(500).json({ message: 'Failed to delete image from database' });
        }

        // Respond with success
        res.status(200).json({ message: 'Image deleted successfully' });

    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

export {
    uploadDoctorsSign,
    getDoctorsSign,
    deleteLabInchargeSign,
    editdoctorsvisibility
};
